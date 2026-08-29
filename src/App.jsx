// Small hand-authored stroke icon set (24x24) — no external icon dependency.
const paths = {
  box: "M3 8l9-5 9 5-9 5-9-5Zm0 0v9l9 5 9-5V8M12 13v9",
  scan: "M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3M4 12h16",
  check: "M8 12.5l2.7 2.7L16 9.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  machine: "M4 7h16v10H4z M8 7V4h8v3 M9 12h1 M14 12h1",
  folder: "M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z",
  qr: "M4 4h5v5H4zM15 4h5v5h-5zM4 15h5v5H4zM15 15h2v2h-2zM19 15h2v2h-2zM15 19h2v2h-2zM19 19h2v2h-2z",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6L6 18",
  camera: "M4 8h3l2-2h6l2 2h3v11H4V8Z M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  arrowLeft: "M19 12H5M12 19l-7-7 7-7",
  scale: "M12 3v18M7 6h10M4 6l3 7a3 3 0 0 0 6 0L10 6M14 6l3 7a3 3 0 0 0 6 0l-3-7",
  logout: "M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4M16 17l5-5-5-5M21 12H9",
  printer: "M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35",
  bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  weight: "M9 3h6l1.5 4h-9L9 3ZM4 8h16l1 12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1L4 8Z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  plus: "M12 5v14M5 12h14",
  lock: "M6 11V8a6 6 0 0 1 12 0v3 M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z M12 15v2.5",
  refresh: "M21 12a9 9 0 1 1-2.64-6.36M21 3v5h-5",
  wifiOff: "M3 3l18 18M8.6 8.6A10 10 0 0 0 5 11 M2 8.8A15 15 0 0 1 8 5.3 M12 5c3.9 0 7.5 1.5 10 4 M16.7 12.7A6 6 0 0 0 12 11 M9 15a4.5 4.5 0 0 1 6 0 M12 19h.01",
  warn: "M10.3 4l-7.4 13A2 2 0 0 0 4.6 20h14.8a2 2 0 0 0 1.7-3l-7.4-13a2 2 0 0 0-3.4 0Z M12 9v4 M12 17h.01",
  expand: "M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13 M10 11v6 M14 11v6",
};

export default function Icon({ name, size = 18, strokeWidth = 1.8, style, className }) {
  const d = paths[name] || paths.box;
  return (
    <svg
      className={className}
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style}
    >
      <path d={d} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
