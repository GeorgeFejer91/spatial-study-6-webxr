[CmdletBinding()]
param(
  [string]$FfprobePath = "ffprobe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$publicRoot = Join-Path $repositoryRoot "public"

if (Test-Path -LiteralPath $FfprobePath -PathType Leaf) {
  $ffprobe = (Resolve-Path -LiteralPath $FfprobePath).Path
} else {
  $command = Get-Command $FfprobePath -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "ffprobe was not found. Install FFmpeg or pass -FfprobePath."
  }
  $ffprobe = $command.Source
}

function Read-Manifest([string]$RelativePath) {
  $path = Join-Path $publicRoot $RelativePath
  return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}

function Resolve-PublicAsset([string]$RelativePath) {
  $path = [System.IO.Path]::GetFullPath((Join-Path $publicRoot $RelativePath))
  $prefix = $publicRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Manifest path escapes public/: $RelativePath"
  }
  return $path
}

function Assert-Equal($Actual, $Expected, [string]$Label) {
  if ($Actual -ne $Expected) {
    throw "$Label mismatch: expected '$Expected', got '$Actual'"
  }
}

function Assert-FileIdentity($Entry) {
  $path = Resolve-PublicAsset ([string]$Entry.path)
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Missing asset: $($Entry.path)"
  }
  Assert-Equal ([int64](Get-Item -LiteralPath $path).Length) ([int64]$Entry.bytes) "$($Entry.path) bytes"
  $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  Assert-Equal $hash ([string]$Entry.sha256) "$($Entry.path) sha256"
  return $path
}

$audio = Read-Manifest "assets/manifests/audio-assets.v1.json"
Assert-Equal ([string]$audio.schema) "spatial.study6.webxr.audio_assets.v1" "audio schema"
Assert-Equal @($audio.files).Count 8 "audio manifest count"
$diskAudio = @(Get-ChildItem -LiteralPath (Join-Path $publicRoot "assets/audio") -File -Filter "*.mp3")
Assert-Equal $diskAudio.Count 8 "audio disk count"
foreach ($entry in @($audio.files)) {
  $path = Assert-FileIdentity $entry
  $probe = (& $ffprobe -v error -show_entries "format=duration:stream=codec_name,sample_rate,channels" -of json $path) | ConvertFrom-Json
  Assert-Equal ([string]$probe.streams[0].codec_name) ([string]$entry.codec) "$($entry.path) codec"
  Assert-Equal ([int]$probe.streams[0].sample_rate) ([int]$entry.sample_rate_hz) "$($entry.path) sample rate"
  Assert-Equal ([int]$probe.streams[0].channels) ([int]$entry.channels) "$($entry.path) channels"
  if ([Math]::Abs([double]$probe.format.duration - [double]$entry.duration_seconds) -gt 0.001) {
    throw "$($entry.path) duration mismatch"
  }
}

$sam = Read-Manifest "assets/manifests/sam-assets.v1.json"
Assert-Equal ([string]$sam.schema) "spatial.study6.webxr.sam_assets.v1" "SAM schema"
Assert-Equal @($sam.files).Count 18 "SAM manifest count"
$diskSam = @(Get-ChildItem -LiteralPath (Join-Path $publicRoot "assets/sam") -Recurse -File -Filter "*.png")
Assert-Equal $diskSam.Count 18 "SAM disk count"
foreach ($entry in @($sam.files)) {
  $path = Assert-FileIdentity $entry
  $probe = (& $ffprobe -v error -show_entries "stream=codec_name,width,height,pix_fmt" -of json $path) | ConvertFrom-Json
  Assert-Equal ([string]$probe.streams[0].codec_name) "png" "$($entry.path) codec"
  Assert-Equal ([int]$probe.streams[0].width) ([int]$entry.width) "$($entry.path) width"
  Assert-Equal ([int]$probe.streams[0].height) ([int]$entry.height) "$($entry.path) height"
  Assert-Equal ([string]$probe.streams[0].pix_fmt) ([string]$entry.pixel_format) "$($entry.path) pixel format"
}

$samNoticePath = Resolve-PublicAsset ([string]$sam.license.notice_path)
$samNoticeHash = (Get-FileHash -LiteralPath $samNoticePath -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-Equal $samNoticeHash ([string]$sam.license.notice_sha256) "SAM notice sha256"

$videos = Read-Manifest "assets/manifests/placeholder-videos.generated.json"
Assert-Equal ([string]$videos.schema) "spatial.study6.webxr.placeholder_video_manifest.v1" "video schema"
Assert-Equal @($videos.files).Count 8 "video manifest count"
$diskVideos = @(Get-ChildItem -LiteralPath (Join-Path $publicRoot "assets/video") -File -Filter "*.mp4")
Assert-Equal $diskVideos.Count 8 "video disk count"
foreach ($entry in @($videos.files)) {
  $path = Assert-FileIdentity $entry
  $probe = (& $ffprobe -v error -show_entries "format=duration:stream=codec_type,codec_name,profile,width,height,pix_fmt,avg_frame_rate,nb_frames" -of json $path) | ConvertFrom-Json
  $videoStreams = @($probe.streams | Where-Object { $_.codec_type -eq "video" })
  $audioStreams = @($probe.streams | Where-Object { $_.codec_type -eq "audio" })
  Assert-Equal $videoStreams.Count 1 "$($entry.path) video stream count"
  Assert-Equal $audioStreams.Count 0 "$($entry.path) audio stream count"
  Assert-Equal ([string]$videoStreams[0].codec_name) "h264" "$($entry.path) codec"
  Assert-Equal ([int]$videoStreams[0].width) 1080 "$($entry.path) width"
  Assert-Equal ([int]$videoStreams[0].height) 720 "$($entry.path) height"
  Assert-Equal ([string]$videoStreams[0].pix_fmt) "yuv420p" "$($entry.path) pixel format"
  Assert-Equal ([int]$videoStreams[0].nb_frames) 300 "$($entry.path) frame count"
  if ([Math]::Abs([double]$probe.format.duration - 300.0) -gt 0.001) {
    throw "$($entry.path) duration must be exactly 300 seconds"
  }
}

$licenses = Read-Manifest "assets/manifests/asset-licenses.v1.json"
Assert-Equal ([string]$licenses.schema) "spatial.study6.webxr.asset_licenses.v1" "license schema"
Assert-Equal @($licenses.assets).Count 3 "license category count"

Write-Host "PASS: 8 exact audio files, 18 SAM PNGs, 8 silent H.264 placeholders, and all provenance/license manifests verified."
