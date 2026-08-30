"use client";

import { useState } from "react";

// D-35 answer (C): joining a round trip asks, outright, whether you are coming back with the same
// driver. There is deliberately no default and no pre-ticked box — "we can do opt in opt out
// because it complicates. If they register, when they register they will be asked" — so this sheet
// has two equally-weighted answers and no way to submit without picking one.
//
// The answer decides who is seated on the return leg when the outbound closes. Saying no is what
// frees the seat for someone else, and nobody sees that seat before the outbound is over.

interface Props {
  time: string;
  returnTime: string | null;
  driver: string;
  onAnswer: (wantsReturn: boolean) => void;
  onClose: () => void;
}

export function ReturnQuestionSheet({ time, returnTime, driver, onAnswer, onClose }: Props) {
  const [pending, setPending] = useState<boolean | null>(null);

  function answer(wantsReturn: boolean) {
    if (pending !== null) return;
    setPending(wantsReturn);
    onAnswer(wantsReturn);
  }

  const option = (wantsReturn: boolean, title: string, detail: string, accent: string, soft: string) => (
    <button
      onClick={() => answer(wantsReturn)}
      disabled={pending !== null}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: pending === wantsReturn ? soft : "var(--surface)",
        border: pending === wantsReturn ? `1px solid ${accent}` : "1px solid rgba(0,0,0,.07)",
        borderRadius: 15,
        padding: "13px 14px",
        marginBottom: 9,
        cursor: pending === null ? "pointer" : "default",
        opacity: pending !== null && pending !== wantsReturn ? 0.5 : 1,
      }}
    >
      <span style={{ display: "block", font: "800 14px var(--font-display)", color: pending === wantsReturn ? accent : "var(--ink)" }}>
        {title}
      </span>
      <span style={{ display: "block", font: "500 11.5px var(--font-body)", color: "rgba(0,0,0,.55)", marginTop: 2 }}>{detail}</span>
    </button>
  );

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheetc" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ font: "800 17px var(--font-display)", color: "var(--ink)", margin: "0 0 2px", textAlign: "left" }}>
          Coming back too?
        </h3>
        <p style={{ font: "500 11.5px var(--font-body)", color: "rgba(0,0,0,.5)", margin: "0 0 14px", textAlign: "left" }}>
          {driver} drives back{returnTime ? ` at ${returnTime}` : ""}. Your seat home is held until the {time} ride is over.
        </p>

        {option(true, "Yes, both ways", "You'll be on the return trip automatically.", "var(--teal)", "rgba(20,184,196,.12)")}
        {option(false, "Just the way there", "Your seat home opens up for someone else.", "var(--ink)", "rgba(0,0,0,.05)")}
      </div>
    </div>
  );
}
