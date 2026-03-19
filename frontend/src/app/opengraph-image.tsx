import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          height: "100%",
          width: "100%",
          background:
            "radial-gradient(circle at top left, rgba(233,207,168,0.55), transparent 35%), radial-gradient(circle at bottom right, rgba(130,164,131,0.24), transparent 30%), linear-gradient(135deg, #f8f1e5 0%, #f2e7d5 55%, #eadcca 100%)",
          color: "#203528",
          padding: "56px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            border: "1px solid rgba(114, 124, 96, 0.18)",
            borderRadius: "32px",
            padding: "48px",
            background: "rgba(255, 249, 239, 0.92)",
            boxShadow: "0 24px 80px rgba(120, 95, 64, 0.1)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "14px",
                fontSize: 26,
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: "#6d7966",
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: "#c8744d",
                }}
              />
              HireScore
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "900px" }}>
              <div style={{ fontSize: 74, fontWeight: 700, lineHeight: 1.02 }}>
                Check if your resume will get shortlisted.
              </div>
              <div style={{ fontSize: 30, lineHeight: 1.32, color: "#4f5f4d" }}>
                Match your resume against any job description and get the score, missing skills, and suggestions.
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
              fontSize: 26,
              color: "#4f5f4d",
            }}
          >
            <div>hirescore.in</div>
            <div style={{ color: "#355e46" }}>Resume match score • Missing skills • Suggestions</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
