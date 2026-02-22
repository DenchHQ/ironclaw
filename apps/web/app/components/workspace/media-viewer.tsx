"use client";

import { useState, useCallback } from "react";

// --- Types ---

export type MediaType = "image" | "video" | "audio" | "pdf";

type MediaViewerProps = {
  /** URL to serve the raw file (e.g. /api/workspace/raw-file?path=...) */
  url: string;
  /** Original filename for display */
  filename: string;
  /** Detected media type */
  mediaType: MediaType;
  /** Original workspace path for download/copy */
  filePath?: string;
};

// --- Extension → MediaType mapping ---

const IMAGE_EXTS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif", "heic", "heif",
  "ico", "tiff", "tif",
]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "avi", "mkv"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac"]);
const PDF_EXTS = new Set(["pdf"]);

/** Returns the media type for a filename, or null if it's not a known media file. */
export function detectMediaType(filename: string): MediaType | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTS.has(ext)) {return "image";}
  if (VIDEO_EXTS.has(ext)) {return "video";}
  if (AUDIO_EXTS.has(ext)) {return "audio";}
  if (PDF_EXTS.has(ext)) {return "pdf";}
  return null;
}

// --- Icons ---

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function ZoomInIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" x2="16.65" y1="21" y2="16.65" />
      <line x1="11" x2="11" y1="8" y2="14" />
      <line x1="8" x2="14" y1="11" y2="11" />
    </svg>
  );
}

function ZoomOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" x2="16.65" y1="21" y2="16.65" />
      <line x1="8" x2="14" y1="11" y2="11" />
    </svg>
  );
}

function mediaTypeLabel(mediaType: MediaType): string {
  switch (mediaType) {
    case "image": return "Image";
    case "video": return "Video";
    case "audio": return "Audio";
    case "pdf": return "PDF";
  }
}

function mediaTypeColor(mediaType: MediaType): string {
  switch (mediaType) {
    case "image": return "#60a5fa";
    case "video": return "#c084fc";
    case "audio": return "#f59e0b";
    case "pdf": return "#ef4444";
  }
}

// --- Main Component ---

export function MediaViewer({ url, filename, mediaType, filePath }: MediaViewerProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div
        className="flex items-center gap-3 px-5 py-3 border-b flex-shrink-0"
        style={{ borderColor: "var(--color-border)" }}
      >
        <MediaTypeIcon mediaType={mediaType} />
        <span className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
          {filename}
        </span>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0"
          style={{
            background: `${mediaTypeColor(mediaType)}18`,
            color: mediaTypeColor(mediaType),
            border: `1px solid ${mediaTypeColor(mediaType)}30`,
          }}
        >
          {mediaTypeLabel(mediaType)}
        </span>

        <div className="flex items-center gap-1 ml-auto">
          {/* Open in new tab */}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-md transition-colors duration-100"
            style={{ color: "var(--color-text-muted)" }}
            title="Open in new tab"
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <ExternalLinkIcon />
          </a>
          {/* Download */}
          <a
            href={url}
            download={filename}
            className="p-1.5 rounded-md transition-colors duration-100"
            style={{ color: "var(--color-text-muted)" }}
            title="Download"
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <DownloadIcon />
          </a>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-6" style={{ background: "var(--color-surface)" }}>
        {mediaType === "image" && <ImageViewer url={url} filename={filename} />}
        {mediaType === "video" && <VideoViewer url={url} />}
        {mediaType === "audio" && <AudioViewer url={url} filename={filename} />}
        {mediaType === "pdf" && <PdfViewer url={url} />}
      </div>

      {/* Footer with path */}
      {filePath && (
        <div
          className="px-5 py-2 border-t flex-shrink-0 flex items-center"
          style={{ borderColor: "var(--color-border)" }}
        >
          <span
            className="text-[11px] truncate"
            style={{ color: "var(--color-text-muted)", fontFamily: "'SF Mono', 'Fira Code', monospace" }}
          >
            {filePath}
          </span>
        </div>
      )}
    </div>
  );
}

// --- Image Viewer (with zoom) ---

function ImageViewer({ url, filename }: { url: string; filename: string }) {
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(false);

  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z * 1.5, 5)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z / 1.5, 0.25)), []);
  const handleReset = useCallback(() => setZoom(1), []);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <span className="text-4xl" style={{ opacity: 0.3 }}>🖼</span>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          Failed to load image
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Zoom controls */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleZoomOut}
          className="p-1.5 rounded-md transition-colors duration-100 cursor-pointer"
          style={{ color: "var(--color-text-muted)" }}
          title="Zoom out"
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        >
          <ZoomOutIcon />
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="px-2 py-1 rounded-md text-[11px] tabular-nums transition-colors duration-100 cursor-pointer"
          style={{ color: "var(--color-text-muted)" }}
          title="Reset zoom"
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={handleZoomIn}
          className="p-1.5 rounded-md transition-colors duration-100 cursor-pointer"
          style={{ color: "var(--color-text-muted)" }}
          title="Zoom in"
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        >
          <ZoomInIcon />
        </button>
      </div>

      {/* Image container with checkerboard background for transparency */}
      <div
        className="overflow-auto max-w-full max-h-[calc(100vh-260px)] rounded-xl border"
        style={{
          borderColor: "var(--color-border)",
          backgroundImage: "linear-gradient(45deg, var(--color-surface-hover) 25%, transparent 25%), linear-gradient(-45deg, var(--color-surface-hover) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-surface-hover) 75%), linear-gradient(-45deg, transparent 75%, var(--color-surface-hover) 75%)",
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={filename}
          onError={() => setError(true)}
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "center center",
            transition: "transform 200ms ease",
            maxWidth: zoom <= 1 ? "100%" : "none",
            display: "block",
          }}
          draggable={false}
        />
      </div>
    </div>
  );
}

// --- Video Viewer ---

function VideoViewer({ url }: { url: string }) {
  return (
    <div className="w-full max-w-4xl">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        src={url}
        controls
        className="w-full rounded-xl border"
        style={{
          borderColor: "var(--color-border)",
          maxHeight: "calc(100vh - 220px)",
          background: "#000",
        }}
      />
    </div>
  );
}

// --- Audio Viewer ---

function AudioViewer({ url, filename }: { url: string; filename: string }) {
  return (
    <div className="flex flex-col items-center gap-6 py-8">
      {/* Visual representation */}
      <div
        className="w-32 h-32 rounded-2xl flex items-center justify-center"
        style={{
          background: "linear-gradient(135deg, #f59e0b20, #f59e0b10)",
          border: "1px solid #f59e0b30",
        }}
      >
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </div>

      <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
        {filename}
      </p>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio src={url} controls className="w-full max-w-md" />
    </div>
  );
}

// --- PDF Viewer ---

function PdfViewer({ url }: { url: string }) {
  return (
    <div className="w-full h-full flex flex-col">
      <iframe
        src={url}
        className="w-full flex-1 rounded-xl border"
        style={{
          borderColor: "var(--color-border)",
          minHeight: "calc(100vh - 220px)",
          background: "white",
        }}
        title="PDF viewer"
      />
    </div>
  );
}

// --- Media type icon ---

function MediaTypeIcon({ mediaType }: { mediaType: MediaType }) {
  const color = mediaTypeColor(mediaType);

  switch (mediaType) {
    case "image":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        </svg>
      );
    case "video":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
          <rect x="2" y="6" width="14" height="12" rx="2" />
        </svg>
      );
    case "audio":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      );
    case "pdf":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M10 9H8" />
          <path d="M16 13H8" />
          <path d="M16 17H8" />
        </svg>
      );
  }
}
