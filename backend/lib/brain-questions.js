'use strict';

/* Real, non-personalised questions about the product as it exists today.
 *
 * Keep this as a source, not scheduler state. createBrain accepts any array or
 * async producer with the same row shape, so replacing this list with the most
 * frequent cacheable questions from usage logs will not change pacing, quota,
 * failure, or cache-skip behaviour. Questions about a user's own history,
 * uploads, preferences, or account are intentionally absent: those turns are
 * personalised and the shared answer cache must reject them. */
const CURATED_QUESTION_TEXTS = Object.freeze([
  'What is ALOP-AI and what is it designed to help with?',
  'How can ALOP-AI support lesson planning in an AI classroom?',
  'Can ALOP-AI create classroom activities, explanations, and quizzes?',
  'How does the ALOP-AI council produce one answer from several models?',
  'How many council models are available on the Free and Pro plans?',
  'What capabilities does ALOP-AI Pro unlock?',
  'How much does ALOP-AI Pro cost?',
  'Does ALOP-AI search the live web and cite its sources?',
  'Which web search sources can ALOP-AI use?',
  'Can ALOP-AI compare current product prices and availability?',
  'Can ALOP-AI open and read a web page from its URL?',
  'What tools can the ALOP-AI council use during research?',
  'Can ALOP-AI create or edit a Canva design directly?',
  'Can ALOP-AI help plan the content and structure of a Canva presentation?',
  'Does ALOP-AI currently have a direct Canva integration?',
  'Can ALOP-AI generate images, and how is image generation requested?',
  'Can ALOP-AI analyse an attached image or a camera photo?',
  'Can the ALOP-AI overlay inspect a shared screen?',
  'Which text file formats can be uploaded to an ALOP-AI chat?',
  'How many files can be attached to one ALOP-AI conversation?',
  'Can the council read an uploaded file while answering a question?',
  'Does ALOP-AI support voice dictation and spoken answers?',
  'Does ALOP-AI remember useful facts across conversations?',
  'Can stored cross-chat memory be viewed and cleared?',
  'Does thumbs-up or thumbs-down feedback change later answers?',
  'Can ALOP-AI answer in languages other than English?',
  'Can ALOP-AI help debug code and explain programming errors?',
  'Can conversations and their attachments be renamed or deleted?',
]);

/**
 * Attach every answer-changing cache-key input to the curated text.
 * `branch` is supplied by server.js because it owns the execution-mode flags;
 * copying that decision here would let the pre-compute key drift from the key
 * used by a real request.
 */
function createBrainQuestions({
  branch,
  lang = 'English',
  country = 'AE',
  plan = 'free',
  detailed = false,
} = {}) {
  return CURATED_QUESTION_TEXTS.map((question) => ({
    question,
    lang,
    country,
    plan,
    detailed: Boolean(detailed),
    branch: typeof branch === 'string' ? branch : '',
  }));
}

module.exports = { CURATED_QUESTION_TEXTS, createBrainQuestions };
