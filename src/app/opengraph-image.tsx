import { ImageResponse } from "next/og";

export const alt = "Mail by Yodev — passerelle email transactionnelle gérée";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#0C1117", color: "#F7F5F0" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
        <span style={{ color: "#315EFB", fontSize: 74, fontWeight: 800 }}>Mail</span>
        <span style={{ color: "#A7B0BE", fontSize: 24, letterSpacing: 5 }}>BY YODEV</span>
      </div>
      <div style={{ display: "flex", maxWidth: 930, fontSize: 58, fontWeight: 700, lineHeight: 1.1 }}>
        Un appel. Un événement. Un destinataire.
      </div>
      <div style={{ display: "flex", color: "#A7B0BE", fontSize: 24 }}>mail.yodev.fr</div>
    </div>,
    size,
  );
}
