import { notFound } from "next/navigation";
import { decorateTrip } from "@/domain/decorateTrip";
import { dayOrder, mockTrips } from "./mockData";

// Dev-only: Phase 0 deliverable per 02_IMPLEMENTATION_PLAN.md §4 (Phase 0). Verified by comparing
// this route to docs/Carpool App.dc.html's phone frame — not a real product route.
export default function StyleguidePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const days = dayOrder
    .map((label) => ({
      label,
      trips: mockTrips
        .filter((t) => t.dayLabel === label)
        .slice()
        .sort((a, b) => a.time.localeCompare(b.time))
        .map(decorateTrip),
    }))
    .filter((d) => d.trips.length > 0);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 40,
        background: "var(--page)",
        padding: "34px 0",
        minHeight: "100vh",
      }}
    >
      <section>
        <h2 style={{ fontFamily: "var(--font-display)", textAlign: "center" }}>
          Carpools tab — vs. Carpool App.dc.html
        </h2>

        <div className="phone">
          <div className="screen">
            <div className="notch" />
            <div className="stat">
              <span>9:41</span>
              <span className="r">
                <span className="d" />
                <span className="d" />
                <span className="d" /> 5G ▪
              </span>
            </div>

            <div style={{ padding: "8px 20px 10px", flex: "none" }}>
              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <div>
                  <div
                    style={{
                      font: "800 22px var(--font-display)",
                      color: "var(--ink)",
                    }}
                  >
                    North Campus <span style={{ color: "rgba(0,0,0,.3)", fontSize: 15 }}>▾</span>
                  </div>
                  <div
                    style={{
                      font: "600 11px var(--font-body)",
                      color: "rgba(0,0,0,.45)",
                      marginTop: 2,
                    }}
                  >
                    Riverside → HQ
                  </div>
                </div>
                <button
                  className="iconbtn"
                  style={{ position: "relative", background: "var(--ink)", color: "var(--surface)", border: "none" }}
                >
                  🔔
                  <span
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 9,
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--coral)",
                      border: "2px solid var(--ink)",
                    }}
                  />
                </button>
              </div>
            </div>

            <div style={{ padding: "0 20px 6px", flex: "none" }}>
              <div className="seg">
                <button className="segb on">All trips</button>
                <button className="segb">
                  Mine{" "}
                  <span
                    style={{
                      background: "var(--purple)",
                      color: "var(--surface)",
                      borderRadius: 8,
                      padding: "1px 6px",
                      fontSize: 9,
                      marginLeft: 3,
                    }}
                  >
                    2
                  </span>
                </button>
              </div>
            </div>

            <div className="scroll" style={{ padding: "0 20px 16px" }}>
              {days.map((day) => (
                <div key={day.label}>
                  <div className="dayh">{day.label}</div>
                  {day.trips.map((t) => (
                    <div key={t.id} className="card" style={{ borderLeftColor: t.accent, marginBottom: 11 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 9,
                        }}
                      >
                        <span className="pill" style={{ color: t.badgeColor, background: t.badgeBg }}>
                          {t.badge}
                        </span>
                        <span style={{ font: "800 14px var(--font-display)", color: "var(--ink)" }}>
                          {t.time}
                        </span>
                      </div>
                      <div className="route">
                        {t.from} <span style={{ color: "rgba(0,0,0,.3)" }}>→</span> {t.to}
                      </div>
                      <div
                        style={{
                          font: "600 12px var(--font-body)",
                          color: "rgba(0,0,0,.5)",
                          marginTop: 4,
                        }}
                      >
                        {t.driverLabel}
                      </div>
                      <div style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 12 }}>
                        {t.avatars.map((a, i) => (
                          <span
                            key={i}
                            className="av"
                            style={{
                              background: a.bg,
                              color: a.fg,
                              border: a.dashed ? "1px dashed rgba(0,0,0,.2)" : undefined,
                            }}
                          >
                            {a.label}
                          </span>
                        ))}
                        <span
                          style={{
                            marginLeft: "auto",
                            font: "700 11px var(--font-body)",
                            color: t.seatColor,
                          }}
                        >
                          {t.seatStr}
                        </span>
                        {t.joinable && (
                          <button
                            style={{
                              width: 30,
                              height: 30,
                              borderRadius: 10,
                              background: "var(--green)",
                              color: "var(--surface)",
                              border: "none",
                              fontSize: 19,
                              fontWeight: 700,
                              flex: "none",
                              boxShadow: "0 3px 8px rgba(23,201,100,.35)",
                              lineHeight: 1,
                            }}
                          >
                            +
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ height: 8 }} />
            </div>

            <div className="tabbar">
              <button className="tab on">
                <span className="i">🚗</span>Carpools
              </button>
              <button className="tab">
                <span className="i">🏆</span>Ranks
              </button>
              <button className="fab">+</button>
              <button className="tab">
                <span className="i">👥</span>Group
              </button>
              <button className="tab">
                <span className="i">👤</span>You
              </button>
            </div>
          </div>
        </div>
      </section>

      <section style={{ width: 322 }}>
        <h2 style={{ fontFamily: "var(--font-display)", textAlign: "center" }}>Primitives</h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div className="dayh">Buttons</div>
            <button className="btnP" style={{ marginBottom: 8 }}>
              Primary action
            </button>
            <button className="btnG">Ink action</button>
          </div>

          <div>
            <div className="dayh">Segmented control</div>
            <div className="seg">
              <button className="segb on">Selected</button>
              <button className="segb">Unselected</button>
            </div>
          </div>

          <div>
            <div className="dayh">Field</div>
            <label className="lbl">Email</label>
            <input className="field" placeholder="you@company.com" readOnly />
          </div>

          <div>
            <div className="dayh">Pills (role badges)</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span className="pill" style={{ color: "var(--purple)", background: "var(--purple-soft)" }}>
                YOU&apos;RE DRIVING
              </span>
              <span className="pill" style={{ color: "var(--teal-ink)", background: "var(--teal-soft)" }}>
                JOINED
              </span>
              <span
                className="pill"
                style={{ color: "rgba(0,0,0,.5)", background: "var(--role-open-badge-bg)" }}
              >
                OPEN · 2 SEATS
              </span>
            </div>
          </div>

          <div>
            <div className="dayh">Avatar stack</div>
            <div style={{ display: "flex", gap: 5 }}>
              <span className="av" style={{ background: "var(--purple)", color: "var(--surface)" }}>
                AM
              </span>
              <span className="av" style={{ background: "var(--amber)", color: "var(--surface)" }}>
                JS
              </span>
              <span
                className="av"
                style={{
                  background: "rgba(0,0,0,.04)",
                  color: "rgba(0,0,0,.35)",
                  border: "1px dashed rgba(0,0,0,.2)",
                }}
              >
                +
              </span>
            </div>
          </div>

          <div style={{ position: "relative", height: 60 }}>
            <div className="dayh">Toast</div>
            <div className="toast" style={{ position: "static", transform: "none" }}>
              Joined — added to your trips 🎉
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
