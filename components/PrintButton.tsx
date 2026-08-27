"use client";

/** زر الطباعة — يختفي في الورقة نفسها عبر `.print-actions` في CSS. */
export function PrintButton() {
  return (
    <div className="print-actions">
      <button type="button" onClick={() => window.print()}>اطبع</button>
    </div>
  );
}
