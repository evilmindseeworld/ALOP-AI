const MODEL = 'openai/text-embedding-3-small';
const DIMENSIONS = 768;

const requestBody = (text) => ({
  model: MODEL,
  input: String(text || '').slice(0, 2000),
  dimensions: DIMENSIONS,
});

const parseEmbedding = (json) => {
  const values = json?.data?.[0]?.embedding;
  return Array.isArray(values) && values.length === DIMENSIONS &&
    values.every((n) => typeof n === 'number' && Number.isFinite(n)) ? values : null;
};

const vectorLiteral = (values) => parseEmbedding({ data: [{ embedding: values }] })
  ? `[${values.join(',')}]` : null;

module.exports = { MODEL, DIMENSIONS, requestBody, parseEmbedding, vectorLiteral };
