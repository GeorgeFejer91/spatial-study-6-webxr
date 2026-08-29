[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [string]$ManifestPath,
  [string]$FfmpegPath = "ffmpeg",
  [string]$FfprobePath = "ffprobe",
  [string]$FontPath,
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $repositoryRoot "public/assets/video"
}
if (-not $ManifestPath) {
  $ManifestPath = Join-Path $repositoryRoot "public/assets/manifests/placeholder-videos.generated.json"
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
$resolvedManifest = [System.IO.Path]::GetFullPath($ManifestPath)
$repositoryPrefix = $repositoryRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedOutput.StartsWith($repositoryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "OutputDirectory must remain inside the repository: $resolvedOutput"
}
if (-not $resolvedManifest.StartsWith($repositoryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "ManifestPath must remain inside the repository: $resolvedManifest"
}

function Resolve-Executable([string]$Candidate, [string]$Label) {
  if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
    return (Resolve-Path -LiteralPath $Candidate).Path
  }
  $command = Get-Command $Candidate -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "$Label was not found. Install FFmpeg or pass an explicit path."
  }
  return $command.Source
}

$ffmpeg = Resolve-Executable $FfmpegPath "ffmpeg"
$ffprobe = Resolve-Executable $FfprobePath "ffprobe"

if (-not $FontPath) {
  $fontCandidates = @(
    "C:\Windows\Fonts\segoeuib.ttf",
    "C:\Windows\Fonts\arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
  )
  $FontPath = $fontCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $FontPath -or -not (Test-Path -LiteralPath $FontPath -PathType Leaf)) {
  throw "A TrueType/OpenType font was not found. Pass -FontPath explicitly."
}
$resolvedFont = (Resolve-Path -LiteralPath $FontPath).Path
$filterFont = $resolvedFont.Replace("\", "/").Replace(":", "\:")

$media = @(
  [ordered]@{ media_id = "Hand_HC_HE"; source_variant = "DHS"; condition_id = "HC_HE"; target = "Hand"; coherence = "high"; energy = "high" },
  [ordered]@{ media_id = "Hand_LC_HE"; source_variant = "DHS"; condition_id = "LC_HE"; target = "Hand"; coherence = "low";  energy = "high" },
  [ordered]@{ media_id = "Hand_HC_LE"; source_variant = "DHS"; condition_id = "HC_LE"; target = "Hand"; coherence = "high"; energy = "low"  },
  [ordered]@{ media_id = "Hand_LC_LE"; source_variant = "DHS"; condition_id = "LC_LE"; target = "Hand"; coherence = "low";  energy = "low"  },
  [ordered]@{ media_id = "Env_HC_HE";  source_variant = "SHD"; condition_id = "HC_HE"; target = "Env";  coherence = "high"; energy = "high" },
  [ordered]@{ media_id = "Env_LC_HE";  source_variant = "SHD"; condition_id = "LC_HE"; target = "Env";  coherence = "low";  energy = "high" },
  [ordered]@{ media_id = "Env_HC_LE";  source_variant = "SHD"; condition_id = "HC_LE"; target = "Env";  coherence = "high"; energy = "low"  },
  [ordered]@{ media_id = "Env_LC_LE";  source_variant = "SHD"; condition_id = "LC_LE"; target = "Env";  coherence = "low";  energy = "low"  }
)

New-Item -ItemType Directory -Force -Path $resolvedOutput,(Split-Path -Parent $resolvedManifest) | Out-Null

$entries = foreach ($item in $media) {
  $outputPath = Join-Path $resolvedOutput ($item.media_id + ".mp4")
  if (Test-Path -LiteralPath $outputPath) {
    if (-not $Force) {
      throw "Generated video already exists: $outputPath. Pass -Force to replace the eight known outputs."
    }
    Remove-Item -LiteralPath $outputPath -Force
  }

  $factorLine = "TARGET $($item.target.ToUpperInvariant())   COHERENCE $($item.coherence.ToUpperInvariant())   ENERGY $($item.energy.ToUpperInvariant())"
  $videoFilter = @(
    "drawtext=fontfile='$filterFont':text='$($item.media_id)':fontcolor=white:fontsize=84:x=(w-text_w)/2:y=92",
    "drawtext=fontfile='$filterFont':text='$factorLine':fontcolor=0xB9C6D8:fontsize=34:x=(w-text_w)/2:y=(h-text_h)/2",
    "drawtext=fontfile='$filterFont':text='PLACEHOLDER VIDEO - NO STIMULUS CONTENT':fontcolor=0x6EA8FF:fontsize=28:x=(w-text_w)/2:y=h-112"
  ) -join ","

  $arguments = @(
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0x070A0F:s=1080x720:r=1:d=300",
    "-vf", $videoFilter,
    "-an", "-map_metadata", "-1",
    "-c:v", "libx264", "-preset", "slow", "-tune", "stillimage", "-crf", "20",
    "-profile:v", "high", "-level:v", "3.1", "-pix_fmt", "yuv420p",
    "-g", "10", "-keyint_min", "10", "-sc_threshold", "0",
    "-frames:v", "300", "-r", "1", "-movflags", "+faststart",
    "-metadata", "title=$($item.media_id) Study 6 placeholder",
    "-metadata", "comment=Placeholder only; contains no experimental stimulus.",
    $outputPath
  )
  & $ffmpeg @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg failed for $($item.media_id) with exit code $LASTEXITCODE"
  }

  $probeJson = & $ffprobe -v error -show_entries "format=duration,size:stream=index,codec_name,profile,width,height,pix_fmt,avg_frame_rate,nb_frames" -of json $outputPath
  if ($LASTEXITCODE -ne 0) {
    throw "ffprobe failed for $($item.media_id) with exit code $LASTEXITCODE"
  }
  $probe = $probeJson | ConvertFrom-Json
  $stream = @($probe.streams)[0]
  [ordered]@{
    media_id = $item.media_id
    source_variant = $item.source_variant
    condition_id = $item.condition_id
    target = $item.target
    coherence = $item.coherence
    energy = $item.energy
    path = "assets/video/$($item.media_id).mp4"
    bytes = [int64](Get-Item -LiteralPath $outputPath).Length
    sha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
    duration_seconds = [decimal]$probe.format.duration
    width = [int]$stream.width
    height = [int]$stream.height
    codec = $stream.codec_name
    profile = $stream.profile
    pixel_format = $stream.pix_fmt
    average_frame_rate = $stream.avg_frame_rate
    frame_count = [int]$stream.nb_frames
    audio_streams = 0
  }
}

$ffmpegVersion = (& $ffmpeg -hide_banner -version | Select-Object -First 1).Trim()
$manifest = [ordered]@{
  schema = "spatial.study6.webxr.placeholder_video_manifest.v1"
  generated_at_utc = [DateTime]::UtcNow.ToString("o")
  generator = [ordered]@{
    script = "tools/Generate-PlaceholderVideos.ps1"
    ffmpeg_version = $ffmpegVersion
    font_file = [System.IO.Path]::GetFileName($resolvedFont)
    font_sha256 = (Get-FileHash -LiteralPath $resolvedFont -Algorithm SHA256).Hash.ToLowerInvariant()
    deterministic_parameters = "1080x720, 300 frames at 1 fps, H.264 High 3.1, yuv420p, CRF 20, GOP 10, no audio"
  }
  content = [ordered]@{
    classification = "placeholder-only"
    participant_eligibility = "ineligible"
    contains_stimulus = $false
    contains_audio = $false
    license = "AGPL-3.0-only"
  }
  files = @($entries)
}

$manifestJson = $manifest | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($resolvedManifest, $manifestJson + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
Write-Host "Generated $($entries.Count) placeholder videos and $resolvedManifest"
