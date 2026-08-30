use std::{
    collections::HashMap,
    env,
    net::SocketAddr,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use axum::{
    Json, Router,
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode, header::ORIGIN},
    response::{IntoResponse, Response},
    routing::get,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tokio::sync::{Mutex, mpsc};
use tracing::{info, warn};

const RELAY_PROTOCOL: &str = "study6.relay.v1";
const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_AUTH_BYTES: usize = 4_096;
const DEFAULT_MAX_FRAME_BYTES: usize = 16_384;
const DEFAULT_QUEUE_CAPACITY: usize = 64;
const DEFAULT_MAX_ROOMS: usize = 1_024;

#[derive(Clone)]
struct Config {
    bind: SocketAddr,
    allowed_origins: Vec<String>,
    max_frame_bytes: usize,
    queue_capacity: usize,
    max_rooms: usize,
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let bind = env::var("STUDY6_RELAY_BIND")
            .unwrap_or_else(|_| "127.0.0.1:8787".to_owned())
            .parse()
            .map_err(|error| format!("invalid STUDY6_RELAY_BIND: {error}"))?;
        let allowed_origins = env::var("STUDY6_RELAY_ALLOWED_ORIGINS")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect();
        Ok(Self {
            bind,
            allowed_origins,
            max_frame_bytes: positive_env("STUDY6_RELAY_MAX_FRAME_BYTES", DEFAULT_MAX_FRAME_BYTES)?,
            queue_capacity: positive_env("STUDY6_RELAY_QUEUE_CAPACITY", DEFAULT_QUEUE_CAPACITY)?,
            max_rooms: positive_env("STUDY6_RELAY_MAX_ROOMS", DEFAULT_MAX_ROOMS)?,
        })
    }

    fn admits_origin(&self, origin: Option<&str>) -> bool {
        match origin {
            None => true, // Native Android clients do not send Origin.
            Some(value) => self.allowed_origins.iter().any(|allowed| allowed == value),
        }
    }
}

fn positive_env(name: &str, default: usize) -> Result<usize, String> {
    match env::var(name) {
        Ok(value) => value
            .parse::<usize>()
            .ok()
            .filter(|parsed| *parsed > 0)
            .ok_or_else(|| format!("{name} must be a positive integer")),
        Err(_) => Ok(default),
    }
}

#[derive(Clone)]
struct AppState {
    config: Config,
    rooms: Arc<Mutex<HashMap<String, Room>>>,
    next_generation: Arc<AtomicU64>,
}

struct Room {
    token_hash: [u8; 32],
    peers: HashMap<String, Peer>,
}

struct Peer {
    role: PeerRole,
    generation: u64,
    tx: mpsc::Sender<OutboundFrame>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum PeerRole {
    Bridge,
    Webxr,
    Controller,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Authentication {
    protocol: String,
    kind: String,
    room: String,
    peer: String,
    role: PeerRole,
    token: String,
}

#[derive(Clone)]
enum OutboundFrame {
    Text(String),
    Binary(Vec<u8>),
    Pong(Vec<u8>),
}

#[derive(Serialize)]
struct Health<'a> {
    status: &'a str,
    protocol: &'a str,
}

#[derive(Serialize)]
struct RelayNotice<'a> {
    protocol: &'a str,
    kind: &'a str,
    status: &'a str,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "study6_control_relay=info,tower_http=info".into()),
        )
        .init();

    let config = Config::from_env().map_err(std::io::Error::other)?;
    let bind = config.bind;
    let state = AppState {
        config,
        rooms: Arc::new(Mutex::new(HashMap::new())),
        next_generation: Arc::new(AtomicU64::new(1)),
    };
    let app = Router::new()
        .route("/healthz", get(health))
        .route("/v1/socket", get(socket))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(bind).await?;
    info!(%bind, "Study 6 opaque control relay listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

async fn health() -> Json<Health<'static>> {
    Json(Health {
        status: "ok",
        protocol: RELAY_PROTOCOL,
    })
}

async fn socket(
    State(state): State<AppState>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    let origin = headers.get(ORIGIN).and_then(|value| value.to_str().ok());
    if !state.config.admits_origin(origin) {
        return (StatusCode::FORBIDDEN, "browser origin is not admitted").into_response();
    }
    upgrade
        .max_message_size(state.config.max_frame_bytes)
        .max_frame_size(state.config.max_frame_bytes)
        .on_upgrade(move |socket| serve_socket(state, socket))
        .into_response()
}

async fn serve_socket(state: AppState, mut socket: WebSocket) {
    let authentication = match receive_authentication(&mut socket).await {
        Ok(authentication) => authentication,
        Err(reason) => {
            let _ = socket.send(Message::Text(reason.into())).await;
            let _ = socket.close().await;
            return;
        }
    };

    let (tx, mut rx) = mpsc::channel(state.config.queue_capacity);
    let generation = state.next_generation.fetch_add(1, Ordering::Relaxed);
    if let Err(reason) = join_room(&state, &authentication, generation, tx.clone()).await {
        let _ = socket.send(Message::Text(reason.into())).await;
        let _ = socket.close().await;
        return;
    }

    let notice = serde_json::to_string(&RelayNotice {
        protocol: RELAY_PROTOCOL,
        kind: "relay_ready",
        status: "authenticated",
    })
    .expect("static relay notice serializes");
    if tx.try_send(OutboundFrame::Text(notice)).is_err() {
        leave_room(
            &state,
            &authentication.room,
            &authentication.peer,
            generation,
        )
        .await;
        return;
    }

    let (mut sink, mut stream) = socket.split();
    let writer = tokio::spawn(async move {
        while let Some(frame) = rx.recv().await {
            let message = match frame {
                OutboundFrame::Text(value) => Message::Text(value.into()),
                OutboundFrame::Binary(value) => Message::Binary(value.into()),
                OutboundFrame::Pong(value) => Message::Pong(value.into()),
            };
            if sink.send(message).await.is_err() {
                break;
            }
        }
    });

    while let Some(message) = stream.next().await {
        let frame = match message {
            Ok(Message::Text(value)) if value.len() <= state.config.max_frame_bytes => {
                Some(OutboundFrame::Text(value.to_string()))
            }
            Ok(Message::Binary(value)) if value.len() <= state.config.max_frame_bytes => {
                Some(OutboundFrame::Binary(value.to_vec()))
            }
            Ok(Message::Ping(value)) => {
                let _ = tx.try_send(OutboundFrame::Pong(value.to_vec()));
                None
            }
            Ok(Message::Pong(_)) => None,
            Ok(Message::Close(_)) | Err(_) => break,
            _ => break,
        };
        if let Some(frame) = frame {
            broadcast(
                &state,
                &authentication.room,
                &authentication.peer,
                generation,
                frame,
            )
            .await;
        }
    }

    leave_room(
        &state,
        &authentication.room,
        &authentication.peer,
        generation,
    )
    .await;
    writer.abort();
}

async fn receive_authentication(socket: &mut WebSocket) -> Result<Authentication, String> {
    let message = tokio::time::timeout(AUTH_TIMEOUT, socket.recv())
        .await
        .map_err(|_| "authentication timeout".to_owned())?
        .ok_or_else(|| "authentication required".to_owned())?
        .map_err(|_| "invalid authentication frame".to_owned())?;
    let Message::Text(value) = message else {
        return Err("first frame must be text authentication".to_owned());
    };
    if value.len() > MAX_AUTH_BYTES {
        return Err("authentication frame is too large".to_owned());
    }
    let authentication: Authentication =
        serde_json::from_str(&value).map_err(|_| "invalid authentication message".to_owned())?;
    if authentication.protocol != RELAY_PROTOCOL || authentication.kind != "authenticate" {
        return Err("unsupported authentication protocol".to_owned());
    }
    if !valid_public_token(&authentication.room, 16, 80)
        || !valid_public_token(&authentication.peer, 8, 80)
        || !valid_secret(&authentication.token)
    {
        return Err("invalid relay identity".to_owned());
    }
    Ok(authentication)
}

async fn join_room(
    state: &AppState,
    authentication: &Authentication,
    generation: u64,
    tx: mpsc::Sender<OutboundFrame>,
) -> Result<(), String> {
    let token_hash = hash_token(&authentication.token);
    let mut rooms = state.rooms.lock().await;
    if !rooms.contains_key(&authentication.room) {
        if rooms.len() >= state.config.max_rooms {
            return Err("relay room capacity reached".to_owned());
        }
        rooms.insert(
            authentication.room.clone(),
            Room {
                token_hash,
                peers: HashMap::new(),
            },
        );
    }
    let room = rooms
        .get_mut(&authentication.room)
        .expect("room was inserted or already existed");
    if !bool::from(room.token_hash.ct_eq(&token_hash)) {
        return Err("relay authentication rejected".to_owned());
    }

    let replaced: Vec<String> = room
        .peers
        .iter()
        .filter(|(_, peer)| peer.role == authentication.role)
        .map(|(peer_id, _)| peer_id.clone())
        .collect();
    for peer_id in replaced {
        room.peers.remove(&peer_id);
    }
    room.peers.insert(
        authentication.peer.clone(),
        Peer {
            role: authentication.role,
            generation,
            tx,
        },
    );
    Ok(())
}

async fn broadcast(
    state: &AppState,
    room_id: &str,
    sender_id: &str,
    sender_generation: u64,
    frame: OutboundFrame,
) {
    let mut rooms = state.rooms.lock().await;
    let Some(room) = rooms.get_mut(room_id) else {
        return;
    };
    if room
        .peers
        .get(sender_id)
        .is_none_or(|peer| peer.generation != sender_generation)
    {
        // A replacement connection with the same role fences the old socket.
        // Its still-running reader must not be able to inject a late command.
        return;
    }
    let mut saturated = Vec::new();
    for (peer_id, peer) in &room.peers {
        if peer_id == sender_id {
            continue;
        }
        if peer.tx.try_send(frame.clone()).is_err() {
            saturated.push(peer_id.clone());
        }
    }
    for peer_id in saturated {
        room.peers.remove(&peer_id);
        warn!("dropping a saturated relay peer");
    }
}

async fn leave_room(state: &AppState, room_id: &str, peer_id: &str, generation: u64) {
    let mut rooms = state.rooms.lock().await;
    let remove_peer = rooms
        .get(room_id)
        .and_then(|room| room.peers.get(peer_id))
        .is_some_and(|peer| peer.generation == generation);
    if remove_peer && let Some(room) = rooms.get_mut(room_id) {
        room.peers.remove(peer_id);
    }
    if rooms.get(room_id).is_some_and(|room| room.peers.is_empty()) {
        rooms.remove(room_id);
    }
}

fn hash_token(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

fn valid_public_token(value: &str, minimum: usize, maximum: usize) -> bool {
    (minimum..=maximum).contains(&value.len())
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
        })
}

fn valid_secret(value: &str) -> bool {
    (43..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(origins: &[&str]) -> Config {
        Config {
            bind: "127.0.0.1:8787".parse().unwrap(),
            allowed_origins: origins.iter().map(|value| (*value).to_owned()).collect(),
            max_frame_bytes: DEFAULT_MAX_FRAME_BYTES,
            queue_capacity: DEFAULT_QUEUE_CAPACITY,
            max_rooms: DEFAULT_MAX_ROOMS,
        }
    }

    #[test]
    fn admits_native_and_only_explicit_browser_origins() {
        let config = config(&["https://example.github.io"]);
        assert!(config.admits_origin(None));
        assert!(config.admits_origin(Some("https://example.github.io")));
        assert!(!config.admits_origin(Some("https://attacker.invalid")));
    }

    #[test]
    fn validates_bounded_public_tokens_and_secrets() {
        assert!(valid_public_token("s6_1234567890abcdef", 16, 80));
        assert!(!valid_public_token("UPPERCASE_NOT_ALLOWED", 16, 80));
        assert!(!valid_public_token("../unsafe_room_name", 16, 80));
        assert!(valid_secret(&"a".repeat(43)));
        assert!(!valid_secret("short"));
    }

    #[test]
    fn token_hashes_are_stable_and_distinct() {
        assert_eq!(hash_token("a"), hash_token("a"));
        assert_ne!(hash_token("a"), hash_token("b"));
    }

    #[tokio::test]
    async fn replacement_generation_fences_the_old_role_socket() {
        let state = AppState {
            config: config(&[]),
            rooms: Arc::new(Mutex::new(HashMap::new())),
            next_generation: Arc::new(AtomicU64::new(1)),
        };
        let token = "a".repeat(43);
        let auth = |peer: &str, role: PeerRole| Authentication {
            protocol: RELAY_PROTOCOL.to_owned(),
            kind: "authenticate".to_owned(),
            room: "s6_1234567890abcdef".to_owned(),
            peer: peer.to_owned(),
            role,
            token: token.clone(),
        };
        let (old_tx, _old_rx) = mpsc::channel(2);
        join_room(
            &state,
            &auth("controller_old", PeerRole::Controller),
            1,
            old_tx,
        )
        .await
        .unwrap();
        let (bridge_tx, mut bridge_rx) = mpsc::channel(2);
        join_room(&state, &auth("bridge_peer", PeerRole::Bridge), 2, bridge_tx)
            .await
            .unwrap();
        let (new_tx, _new_rx) = mpsc::channel(2);
        join_room(
            &state,
            &auth("controller_new", PeerRole::Controller),
            3,
            new_tx,
        )
        .await
        .unwrap();

        broadcast(
            &state,
            "s6_1234567890abcdef",
            "controller_old",
            1,
            OutboundFrame::Text("stale".to_owned()),
        )
        .await;
        assert!(bridge_rx.try_recv().is_err());

        broadcast(
            &state,
            "s6_1234567890abcdef",
            "controller_new",
            3,
            OutboundFrame::Text("current".to_owned()),
        )
        .await;
        match bridge_rx.try_recv().unwrap() {
            OutboundFrame::Text(value) => assert_eq!(value, "current"),
            _ => panic!("expected a text frame"),
        }
    }
}
