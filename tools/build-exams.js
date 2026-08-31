#!/usr/bin/env node
// Parses exams/*.md into a single consistent JSON schema consumed by
// exam-simulator.html, so the browser never has to regex-parse markdown
// at runtime.
//
// Usage: node tools/build-exams.js

const fs = require('fs');
const path = require('path');

const EXAMS_DIR = path.join(__dirname, '..', 'exams');

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

function finalize(questions, title) {
  return {
    title,
    questions: questions
      .filter((q) => q.id && q.prompt && Object.keys(q.options).length)
      .sort((a, b) => a.number - b.number)
      .map((q) => ({ ...q, sources: [...new Set(q.sources)] }))
  };
}

function build(mdFile, idPrefix, title, outFile) {
  const mdPath = path.join(EXAMS_DIR, mdFile);
  const outPath = path.join(EXAMS_DIR, outFile);
  const markdown = fs.readFileSync(mdPath, 'utf8');
  const data = finalize(parseQuestionBlocks(markdown, idPrefix), title);

  const missingRationale = data.questions.filter((q) => !q.correct || !q.rationale);
  if (missingRationale.length) {
    console.warn(`${mdFile}: ${missingRationale.length} question(s) missing correct answer or rationale`);
  }

  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
  console.log(`${mdFile} -> ${outFile}: ${data.questions.length} questions`);
}

build('exam-set-1-complete-260.md', 'S01', 'Set 1: Complete exam', 'exam-set-1-complete-260.json');
build('exam-set-2-alternate-260.md', 'S02', 'Set 2: Alternate exam', 'exam-set-2-alternate-260.json');
