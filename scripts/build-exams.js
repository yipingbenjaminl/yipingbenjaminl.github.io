#!/usr/bin/env node
// Parses data/exams/*.md into a single consistent JSON schema consumed by
// exam-simulator.html, so the browser never has to regex-parse markdown
// at runtime.
//
// Usage: node scripts/build-exams.js

const fs = require('fs');
const path = require('path');

const EXAMS_DIR = path.join(__dirname, '..', 'data', 'exams');

function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// Unifies source citations into "Textbook (Year).pdf — PDF p. N" and drops
// internal passage IDs, which aren't meaningful to a reader.
function normalizeSource(text) {
  return normalize(text)
    .replace(/\s*\(PDF p.\s*(\d+)\)/, ' — PDF p. $1')
    .replace(/,\s*passage\s*\d+\s*$/i, '');
}

// Both Set 1 and Set 2 now share one source format: a single block per
// question, heading "## <idPrefix>-Q001", then:
//   Domain N · Topic
//   <prompt>
//   A. ...
//   B. ...
//   **Difficulty: Foundational|Intermediate|Advanced**
//   **First-pass status: ...**              (optional)
//   **Answer: A**
//   **A — correct:** ...
//   <explanation>
//   Best-answer reasoning: ...               (correct option, not always present)
//   **B:** ...
//   <explanation>
//   Why it is not best here: ...             (incorrect options, not always present)
//   **Evidence sources:**
//   - source, passage
function parseQuestionBlocks(markdown, idPrefix) {
  const byId = new Map();
  const idPattern = new RegExp(`${idPrefix}-Q\\d+`);

  const blocks = markdown.split(new RegExp(`\\n(?=## ${idPrefix}-Q\\d+)`));

  blocks.forEach((block) => {
    const headingMatch = block.match(new RegExp(`^## (${idPrefix}-Q\\d+)`));
    if (!headingMatch) return;

    const id = headingMatch[1];
    const body = block.slice(headingMatch[0].length).trim();

    const optionPattern = /(^|\n)([A-D])\.\s*([^\n]+(?:\n(?![A-D]\.)[^\n]+)*)/g;
    const optionMatches = [...body.matchAll(optionPattern)];

    const options = {};
    optionMatches.forEach((m) => {
      options[m[2]] = normalize(m[3]);
    });

    const domainMatch = body.match(/^Domain[^\n]*\n/);
    const domain = domainMatch ? normalize(domainMatch[0]) : '';
    const promptStart = domainMatch ? domainMatch[0].length : 0;
    const promptEnd = optionMatches.length ? optionMatches[0].index : body.length;
    const prompt = normalize(body.slice(promptStart, promptEnd));

    const difficultyMatch = body.match(/\*\*Difficulty:\s*([^*]+)\*\*/);
    const difficulty = difficultyMatch ? normalize(difficultyMatch[1]) : '';

    const firstPassMatch = body.match(/\*\*First-pass status:\s*([^*]+)\*\*/);
    const firstPassStatus = firstPassMatch ? normalize(firstPassMatch[1]) : '';

    const answerMatch = body.match(/\*\*Answer:\s*([A-D])\*\*/);
    const correct = answerMatch ? answerMatch[1] : '';

    const optionExplanations = {};
    let bestAnswerReasoning = '';
    const whyNotBest = {};
    const explanationMatches = [...body.matchAll(
      /\*\*\s*([A-D])\s*(?:—\s*correct)?\s*:\*\*\s*[^\n]+\n\n([\s\S]+?)(?=\n\n\*\*\s*[A-D]\s*(?:—\s*correct)?\s*:\*\*|\n\n\*\*Evidence sources:\*\*|$)/g
    )];
    explanationMatches.forEach((m) => {
      const letter = m[1];
      const raw = m[2];

      const bestMatch = raw.match(/\n\nBest-answer reasoning:\s*([\s\S]+)$/);
      const whyMatch = raw.match(/\n\nWhy it is not best here:\s*([\s\S]+)$/);

      if (bestMatch) {
        bestAnswerReasoning = normalize(bestMatch[1]);
      }
      if (whyMatch) {
        whyNotBest[letter] = normalize(whyMatch[1]);
      }

      const mainText = bestMatch ? raw.slice(0, bestMatch.index)
        : whyMatch ? raw.slice(0, whyMatch.index)
        : raw;
      optionExplanations[letter] = normalize(mainText);
    });

    const sourcesBlockMatch = body.match(/\*\*Evidence sources:\*\*\s*\n([\s\S]*)$/);
    const sources = sourcesBlockMatch
      ? [...sourcesBlockMatch[1].matchAll(/-\s*([^\n]+)/g)].map((m) => normalizeSource(m[1]))
      : [];

    byId.set(id, {
      id,
      number: Number((id.match(/Q0*(\d+)/) || [])[1] || 0),
      prompt,
      domain,
      difficulty,
      firstPassStatus,
      options,
      correct,
      rationale: optionExplanations[correct] || '',
      optionExplanations,
      bestAnswerReasoning,
      whyNotBest,
      sources
    });
  });

  return Array.from(byId.values());
}

// Textbook-rationale-rewrite format: single block per question, heading
// "## <idPrefix>-Q001", question/options reproduced unchanged but no domain
// or difficulty tags (those live only in the base file). Then:
//   **Answer: A**
//   **Rationale status:** rewritten|evidence_limited|...
//   **Why the keyed answer is best:** <summary>
//   **A — correct:** <explanation> [Citation.pdf, Chapter, PDF p. N, ...]
//   **B — true but irrelevant:** <explanation> [citation]
//   ...                                        (verdict tag varies per option,
//                                                citation bracket sometimes absent)
//   **Evidence sufficiency:** <note>
//   **Editorial QA observations:**              (optional)
//   - <note>
function normalizeTextbookCitation(raw) {
  const match = raw.match(/^([^,]+\.pdf),\s*(.+?),\s*PDF p\.\s*(\d+)(?:,\s*printed p\.\s*[^,]+)?(?:,\s*passage ID\s*[^,]+)?$/);
  if (!match) return normalize(raw);
  return `${match[1].trim()} — ${match[2].trim()} — PDF p. ${match[3]}`;
}

function parseTextbookRationaleBlocks(markdown, idPrefix) {
  const byId = new Map();
  const blocks = markdown.split(new RegExp(`\\n(?=## ${idPrefix}-Q\\d+)`));

  blocks.forEach((block) => {
    const headingMatch = block.match(new RegExp(`^## (${idPrefix}-Q\\d+)`));
    if (!headingMatch) return;

    const id = headingMatch[1];
    const body = block.slice(headingMatch[0].length).trim();

    const rationaleStatusMatch = body.match(/\*\*Rationale status:\*\*\s*([^\n]+)/);
    const rationaleStatus = rationaleStatusMatch ? normalize(rationaleStatusMatch[1]) : '';

    const sourcesSet = new Set();

    // Strips a trailing " [Citation.pdf, Chapter, PDF p. N, ...]" bracket off
    // explanation text, adding the normalized citation to sourcesSet.
    function stripTrailingCitation(text) {
      const citeMatch = text.match(/\s*\[([^\]]+)\]\s*$/);
      if (!citeMatch) return text;
      const source = normalizeTextbookCitation(citeMatch[1]);
      if (source) sourcesSet.add(source);
      return normalize(text.slice(0, citeMatch.index));
    }

    const whyBestMatch = body.match(/\*\*Why the keyed answer is best:\*\*\s*([\s\S]+?)(?=\n\n\*\*[A-D] — )/);
    const rationale = whyBestMatch ? stripTrailingCitation(normalize(whyBestMatch[1])) : '';

    const optionVerdicts = {};
    const optionExplanations = {};

    const optionMatches = [...body.matchAll(
      /\*\*([A-D]) — ([^:*]+):\*\*\s*([\s\S]+?)(?=\n\n\*\*[A-D] — |\n\n\*\*Evidence sufficiency:\*\*|\n\n\*\*Editorial QA observations:\*\*|$)/g
    )];

    optionMatches.forEach((m) => {
      const letter = m[1];
      const tag = normalize(m[2]);
      const text = stripTrailingCitation(normalize(m[3]));

      optionVerdicts[letter] = tag;
      optionExplanations[letter] = text;
    });

    const evidenceSufficiencyMatch = body.match(/\*\*Evidence sufficiency:\*\*\s*([^\n]+)/);
    const evidenceSufficiency = evidenceSufficiencyMatch ? normalize(evidenceSufficiencyMatch[1]) : '';

    const editorialQABlockMatch = body.match(/\*\*Editorial QA observations:\*\*\s*\n([\s\S]*)$/);
    const editorialQA = editorialQABlockMatch
      ? [...editorialQABlockMatch[1].matchAll(/-\s*([^\n]+)/g)].map((m) => normalize(m[1]))
      : [];

    byId.set(id, {
      rationale,
      optionExplanations,
      optionVerdicts,
      sources: [...sourcesSet],
      rationaleStatus,
      evidenceSufficiency,
      editorialQA
    });
  });

  return byId;
}

// Merges a base question file (question/options/domain/difficulty) with a
// separately authored, textbook-grounded rationale rewrite, matched by
// question ID. The rationale file intentionally carries no domain/difficulty
// data, so those always come from the base file.
function buildWithTextbookRationales(baseMdFile, rationaleMdFile, idPrefix, title, outFile) {
  const basePath = path.join(EXAMS_DIR, baseMdFile);
  const rationalePath = path.join(EXAMS_DIR, rationaleMdFile);
  const outPath = path.join(EXAMS_DIR, outFile);

  const baseQuestions = parseQuestionBlocks(fs.readFileSync(basePath, 'utf8'), idPrefix);
  const rationaleById = parseTextbookRationaleBlocks(fs.readFileSync(rationalePath, 'utf8'), idPrefix);

  let missingRationale = 0;
  const merged = baseQuestions.map((q) => {
    const r = rationaleById.get(q.id);
    if (!r) {
      missingRationale += 1;
      return q;
    }
    return {
      ...q,
      rationale: r.rationale || q.rationale,
      optionExplanations: Object.keys(r.optionExplanations).length ? r.optionExplanations : q.optionExplanations,
      optionVerdicts: r.optionVerdicts,
      sources: r.sources,
      rationaleStatus: r.rationaleStatus,
      evidenceSufficiency: r.evidenceSufficiency,
      editorialQA: r.editorialQA,
      bestAnswerReasoning: '',
      whyNotBest: {}
    };
  });

  if (missingRationale) {
    console.warn(`${rationaleMdFile}: ${missingRationale} question(s) had no matching rationale entry, kept base rationale`);
  }

  const data = finalize(merged, title);
  const missingCorrectOrRationale = data.questions.filter((q) => !q.correct || !q.rationale);
  if (missingCorrectOrRationale.length) {
    console.warn(`${outFile}: ${missingCorrectOrRationale.length} question(s) missing correct answer or rationale`);
  }

  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
  console.log(`${baseMdFile} + ${rationaleMdFile} -> ${outFile}: ${data.questions.length} questions`);
}

function finalize(questions, title) {
  return {
    title,
    questions: questions
      .filter((q) => q.id && q.prompt && Object.keys(q.options).length)
      .sort((a, b) => a.number - b.number)
      .map((q) => ({ ...q, sources: [...new Set(q.sources)] }))
  };
}

buildWithTextbookRationales('exam-set-1.md', 'exam-set-1-rationales.md', 'S01', 'Exam Set 1', 'exam-set-1.json');
buildWithTextbookRationales('exam-set-2.md', 'exam-set-2-rationales.md', 'S02', 'Exam Set 2', 'exam-set-2.json');
buildWithTextbookRationales('exam-set-3.md', 'exam-set-3-rationales.md', 'S03', 'Exam Set 3', 'exam-set-3.json');
