// Leitura e validacao das variaveis de ambiente.
// Falha cedo e com mensagem clara em vez de quebrar no meio do atendimento.

function obrigatorio(nome) {
  const v = process.env[nome];
  if (!v || !String(v).trim()) {
    throw new Error(`Variavel de ambiente obrigatoria nao definida: ${nome}`);
  }
  return String(v).trim();
}

function texto(nome, padrao) {
  const v = process.env[nome];
  return v && String(v).trim() ? String(v).trim() : padrao;
}

function numero(nome, padrao) {
  const v = process.env[nome];
  if (v === undefined || String(v).trim() === '') return padrao;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) {
    throw new Error(`Variavel ${nome} precisa ser numerica (recebido: "${v}")`);
  }
  return n;
}

function lista(nome) {
  return texto(nome, '')
    .split(',')
    .map((s) => s.replace(/\D/g, ''))
    .filter(Boolean);
}

const MODOS_VALIDOS = ['mudo', 'piloto', 'ativo'];
const modo = texto('MODO', 'mudo').toLowerCase();
if (!MODOS_VALIDOS.includes(modo)) {
  throw new Error(`MODO invalido: "${modo}". Use um de: ${MODOS_VALIDOS.join(', ')}`);
}

export const config = {
  porta: numero('PORT', 3000),

  modo,
  whitelist: lista('WHITELIST'),

  evolution: {
    url: obrigatorio('EVOLUTION_URL').replace(/\/+$/, ''),
    apikey: obrigatorio('EVOLUTION_APIKEY'),
    instancia: obrigatorio('EVOLUTION_INSTANCE'),
  },

  webhookToken: obrigatorio('WEBHOOK_TOKEN'),
  adminToken: obrigatorio('ADMIN_TOKEN'),

  databaseUrl: obrigatorio('DATABASE_URL'),

  minimoKg: numero('MINIMO_KG', 25),

  // Anuncios do Mercado Livre, usados so no caminho "bastao abaixo do minimo".
  // Nao existe anuncio de granulado: esse caminho vai para atendimento humano.
  linkBastao11: texto('LINK_ML_BASTAO_11MM', ''),
  linkBastao74: texto('LINK_ML_BASTAO_74MM', ''),

  delayMinMs: numero('DELAY_MIN_MS', 2000),
  delayMaxMs: numero('DELAY_MAX_MS', 6000),

  janelaSaudacaoHoras: numero('JANELA_SAUDACAO_HORAS', 72),
};

if (config.modo === 'piloto' && config.whitelist.length === 0) {
  throw new Error('MODO=piloto exige pelo menos um numero em WHITELIST.');
}

if (config.modo === 'ativo' && (!config.linkBastao11 || !config.linkBastao74)) {
  throw new Error('MODO=ativo exige LINK_ML_BASTAO_11MM e LINK_ML_BASTAO_74MM preenchidos.');
}

if (config.delayMaxMs < config.delayMinMs) {
  throw new Error('DELAY_MAX_MS nao pode ser menor que DELAY_MIN_MS.');
}
