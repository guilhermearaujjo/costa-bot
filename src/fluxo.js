// Maquina de estados do atendimento. Sem LLM, sem chamada externa:
// entra estado + texto, sai a decisao. Isso deixa o fluxo testavel isoladamente.

import { textos, montar } from './textos.js';

export const ESTADOS = {
  NOVO: 'novo',
  AGUARDANDO_MENU: 'aguardando_menu',
  AGUARDANDO_QTD: 'aguardando_qtd',
  ENCERRADO: 'encerrado',
  IGNORADO: 'ignorado',
};

const PALAVRAS_COLA = [
  'cola', 'colas', 'hot melt', 'hotmelt', 'hot-melt', 'granulad', 'bastao', 'bastão',
  'adesivo', 'pellet', 'lomba', 'termoplastic', 'silicone',
];

const PALAVRAS_OUTRO = [
  'outro assunto', 'outro', 'importacao', 'importação', 'exportacao', 'exportação',
  'financeiro', 'nota fiscal', 'curriculo', 'currículo', 'parceria', 'fornecedor de',
];

const NUMEROS_POR_EXTENSO = {
  meia: 0.5, meio: 0.5, uma: 1, um: 1, duas: 2, dois: 2, tres: 3, 'três': 3,
  quatro: 4, cinco: 5, dez: 10, vinte: 20, cinquenta: 50, cem: 100,
};

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

// "1" e "2" sozinhos sao escolha de menu, nunca quantidade.
// Sem isso, quem responde "1" seria lido como "1 kg" e cairia no Mercado Livre.
export function ehRespostaDeMenu(texto) {
  return /^\s*[12]\s*[-.)]?\s*$/.test(normalizar(texto));
}

export function detectarIntencao(texto) {
  const t = normalizar(texto);
  if (!t) return 'desconhecida';

  // Resposta direta do menu
  if (/^\s*1\s*[-.)]?\s*$/.test(t)) return 'cola';
  if (/^\s*2\s*[-.)]?\s*$/.test(t)) return 'outro';

  const temCola = PALAVRAS_COLA.some((p) => t.includes(normalizar(p)));
  if (temCola) return 'cola';

  const temOutro = PALAVRAS_OUTRO.some((p) => t.includes(normalizar(p)));
  if (temOutro) return 'outro';

  return 'desconhecida';
}

// Extrai quantidade em kg. Entende "50", "50kg", "1 tonelada", "2.000 kg", "2,5 t".
// Devolve null quando nao da para confiar no que veio.
export function extrairQuantidadeKg(texto) {
  const t = normalizar(texto);
  if (!t) return null;

  // Numero por extenso seguido de unidade: "uma tonelada", "meia tonelada"
  const porExtenso = t.match(
    /\b(meia|meio|uma|um|duas|dois|tres|quatro|cinco|dez|vinte|cinquenta|cem)\s+(tonelada|toneladas|ton|kg|quilo|quilos)\b/,
  );
  if (porExtenso) {
    const valor = NUMEROS_POR_EXTENSO[porExtenso[1]];
    const ehTonelada = porExtenso[2].startsWith('ton');
    return validar(ehTonelada ? valor * 1000 : valor);
  }

  // Numero com unidade opcional. Ponto como milhar, virgula como decimal.
  const comUnidade = t.match(
    /(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*(toneladas|tonelada|ton|t|kgs|kg|quilos|quilo|k)?\b/,
  );
  if (!comUnidade) return null;

  let bruto = comUnidade[1];
  // "2.000" -> 2000 ; "2,5" -> 2.5 ; "2.5" -> 2.5
  if (/^\d{1,3}(\.\d{3})+$/.test(bruto)) {
    bruto = bruto.replace(/\./g, '');
  }
  bruto = bruto.replace(',', '.');

  const valor = Number(bruto);
  if (!Number.isFinite(valor)) return null;

  const unidade = comUnidade[2] || '';
  const ehTonelada = unidade === 't' || unidade.startsWith('ton');

  return validar(ehTonelada ? valor * 1000 : valor);
}

function validar(kg) {
  if (!Number.isFinite(kg) || kg <= 0) return null;
  // Acima disso quase certamente e telefone, CNPJ ou digitacao errada.
  if (kg > 100000) return null;
  return kg;
}

/**
 * Decide o que fazer com a mensagem recebida.
 *
 * @returns {{
 *   resposta: string|null,
 *   estado: string,
 *   interesse: string|null,
 *   tentativas: number,
 *   lead: object|null,
 *   entregarAoHumano: boolean,
 *   motivo: string
 * }}
 */
export function processar({ estado, tentativas = 0, interesse = null, texto, minimoKg, linkMercadoLivre }) {
  const nada = {
    resposta: null,
    estado,
    interesse,
    tentativas,
    lead: null,
    entregarAoHumano: false,
    motivo: 'sem_acao',
  };

  if (estado === ESTADOS.ENCERRADO || estado === ESTADOS.IGNORADO) {
    return { ...nada, motivo: `estado_${estado}` };
  }

  const resolverQuantidade = (kg) => {
    if (kg >= minimoKg) {
      return {
        resposta: textos.leadQualificado,
        estado: ESTADOS.ENCERRADO,
        interesse: 'cola',
        tentativas: 0,
        lead: { interesse: 'cola', quantidadeKg: kg, desfecho: 'lead' },
        entregarAoHumano: true,
        motivo: 'lead_qualificado',
      };
    }
    return {
      resposta: montar(textos.abaixoDoMinimo, { link: linkMercadoLivre }),
      estado: ESTADOS.ENCERRADO,
      interesse: 'cola',
      tentativas: 0,
      lead: { interesse: 'cola', quantidadeKg: kg, desfecho: 'mercado_livre' },
      entregarAoHumano: false,
      motivo: 'abaixo_do_minimo',
    };
  };

  // --- primeiro contato -----------------------------------------
  if (estado === ESTADOS.NOVO) {
    const intencao = detectarIntencao(texto);

    if (intencao === 'cola') {
      const kg = ehRespostaDeMenu(texto) ? null : extrairQuantidadeKg(texto);
      if (kg !== null) return resolverQuantidade(kg);

      return {
        resposta: `${textos.saudacao.split('\n')[0]}\n\n${textos.perguntaQuantidade}`,
        estado: ESTADOS.AGUARDANDO_QTD,
        interesse: 'cola',
        tentativas: 0,
        lead: null,
        entregarAoHumano: false,
        motivo: 'cola_detectada_no_primeiro_contato',
      };
    }

    return {
      resposta: textos.saudacao,
      estado: ESTADOS.AGUARDANDO_MENU,
      interesse: null,
      tentativas: 0,
      lead: null,
      entregarAoHumano: false,
      motivo: 'saudacao_com_menu',
    };
  }

  // --- esperando a escolha do menu ------------------------------
  if (estado === ESTADOS.AGUARDANDO_MENU) {
    const intencao = detectarIntencao(texto);

    if (intencao === 'cola') {
      const kg = ehRespostaDeMenu(texto) ? null : extrairQuantidadeKg(texto);
      if (kg !== null) return resolverQuantidade(kg);

      return {
        resposta: textos.perguntaQuantidade,
        estado: ESTADOS.AGUARDANDO_QTD,
        interesse: 'cola',
        tentativas: 0,
        lead: null,
        entregarAoHumano: false,
        motivo: 'escolheu_cola',
      };
    }

    if (intencao === 'outro') {
      return {
        resposta: textos.outroAssunto,
        estado: ESTADOS.ENCERRADO,
        interesse: 'outro',
        tentativas: 0,
        lead: { interesse: 'outro', quantidadeKg: null, desfecho: 'outro_assunto' },
        entregarAoHumano: true,
        motivo: 'outro_assunto',
      };
    }

    const novasTentativas = tentativas + 1;
    if (novasTentativas >= 2) {
      return {
        resposta: textos.desistoVaiProHumano,
        estado: ESTADOS.ENCERRADO,
        interesse: null,
        tentativas: novasTentativas,
        lead: { interesse: null, quantidadeKg: null, desfecho: 'humano' },
        entregarAoHumano: true,
        motivo: 'nao_entendi_menu_2x',
      };
    }

    return {
      resposta: textos.naoEntendiMenu,
      estado: ESTADOS.AGUARDANDO_MENU,
      interesse: null,
      tentativas: novasTentativas,
      lead: null,
      entregarAoHumano: false,
      motivo: 'nao_entendi_menu',
    };
  }

  // --- esperando a quantidade -----------------------------------
  if (estado === ESTADOS.AGUARDANDO_QTD) {
    const kg = extrairQuantidadeKg(texto);
    if (kg !== null) return resolverQuantidade(kg);

    const novasTentativas = tentativas + 1;
    if (novasTentativas >= 2) {
      return {
        resposta: textos.desistoVaiProHumano,
        estado: ESTADOS.ENCERRADO,
        interesse: 'cola',
        tentativas: novasTentativas,
        lead: { interesse: 'cola', quantidadeKg: null, desfecho: 'humano' },
        entregarAoHumano: true,
        motivo: 'nao_entendi_quantidade_2x',
      };
    }

    return {
      resposta: textos.naoEntendiQuantidade,
      estado: ESTADOS.AGUARDANDO_QTD,
      interesse: 'cola',
      tentativas: novasTentativas,
      lead: null,
      entregarAoHumano: false,
      motivo: 'nao_entendi_quantidade',
    };
  }

  return nada;
}
