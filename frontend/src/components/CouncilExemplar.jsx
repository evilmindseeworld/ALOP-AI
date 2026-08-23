import { useId } from "react";

/**
 * A fixed, reviewed landing example of the council's shape.
 *
 * This is deliberately not a simulated live turn: it has no seat names,
 * runtime counts, citations, loading state, or claim that the backend just
 * did this work. The label keeps the distinction honest while giving a
 * first-time visitor the missing consequence that a roster alone cannot show:
 * several angles becoming one bounded reply.
 */
const EXEMPLAR_QUESTION = "Should a small team choose Postgres or MongoDB for a social app?";

const EXEMPLAR_STEPS = [
  {
    number: "01",
    title: "Gather",
    body: "Independent technical, operational, and growth angles are considered.",
  },
  {
    number: "02",
    title: "Reconcile",
    body: "Useful agreement is kept; the meaningful trade-off stays visible.",
  },
];

export default function CouncilExemplar() {
  const titleId = `council-exemplar-title-${useId().replaceAll(":", "")}`;

  return (
    <section className="council-exemplar" aria-labelledby={titleId}>
      <p className="council-exemplar-label">Reviewed example · not a live turn</p>
      <h2 id={titleId} className="council-exemplar-title">
        See the shape of a council answer
      </h2>
      <p className="council-exemplar-intro">
        One question enters. Independent angles are gathered. The useful overlap is reconciled into one readable reply.
      </p>

      <div className="council-exemplar-flow">
        <div className="council-exemplar-question">
          <span className="council-exemplar-kicker">Question</span>
          <p>{EXEMPLAR_QUESTION}</p>
        </div>

        <ol className="council-exemplar-steps" aria-label="Reviewed council steps">
          {EXEMPLAR_STEPS.map((step) => (
            <li key={step.number} className="council-exemplar-step">
              <span className="council-exemplar-number" aria-hidden="true">{step.number}</span>
              <span>
                <strong>{step.title}</strong>
                <span>{step.body}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="council-exemplar-answer">
          <span className="council-exemplar-kicker">One reply</span>
          <p>
            Choose Postgres when relationships, transactions, and a dependable source of truth matter most. Choose MongoDB only when your data is deliberately document-shaped and the trade-off is worth it.
          </p>
        </div>
      </div>

      <p className="council-exemplar-footnote">
        Fixed product example. Your question is handled by the live council after sign-in.
      </p>
    </section>
  );
}
