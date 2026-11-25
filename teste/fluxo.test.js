// Testes do fluxo. Rodam sem banco, sem rede e sem Evolution.
// `npm run teste`

import assert from 'node:assert/strict';
import {
  processar,
  ESTADOS,
  INTERESSES,
  extrairQuantidadeKg,
  detectarIntencao,
} from '../src/fluxo.js';

const MINIMO = 25;
const L11 = 'https://ml.exemplo/bastao-11mm';
const L74 = 'https://ml.exemplo/bastao-74mm';

let passou = 0;
let falhou = 0;

function teste(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  ok   ${nome}`);
  } catch (erro) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${erro.message}`);
  }
}

const rodar = (estado, texto, extra = {}) =>
  processar({
    estado,
    texto,
    minimoKg: MINIMO,
    linkBastao11: L11,
    linkBastao74: L74,
    ...extra,
  });

console.log('\n-- extrairQuantidadeKg --');
teste('numero puro vira kg', () => assert.equal(extrairQuantidadeKg('50'), 50));
teste('com unidade kg', () => assert.equal(extrairQuantidadeKg('50kg'), 50));
teste('com espaco e unidade', () => assert.equal(extrairQuantidadeKg('preciso de 200 kg'), 200));
teste('tonelada vira 1000', () => assert.equal(extrairQuantidadeKg('1 tonelada'), 1000));
teste('abreviacao t', () => assert.equal(extrairQuantidadeKg('2t'), 2000));
teste('milhar com ponto', () => assert.equal(extrairQuantidadeKg('2.000 kg'), 2000));
teste('decimal com virgula', () => assert.equal(extrairQuantidadeKg('2,5 kg'), 2.5));
teste('meia tonelada', () => assert.equal(extrairQuantidadeKg('meia tonelada'), 500));
teste('texto sem numero vira null', () => assert.equal(extrairQuantidadeKg('bastante'), null));
teste('valor absurdo vira null', () => assert.equal(extrairQuantidadeKg('11987654321'), null));
teste('zero vira null', () => assert.equal(extrairQuantidadeKg('0 kg'), null));

console.log('\n-- detectarIntencao --');
teste('opcao 1 e granulado', () => assert.equal(detectarIntencao('1'), INTERESSES.GRANULADO));
teste('opcao 2 e bastao', () => assert.equal(detectarIntencao('2'), INTERESSES.BASTAO));
teste('opcao 3 e outro', () => assert.equal(detectarIntencao('3'), INTERESSES.OUTRO));
teste('granulada e granulado', () =>
  assert.equal(detectarIntencao('quero cola granulada'), INTERESSES.GRANULADO));
teste('pellets e granulado', () =>
  assert.equal(detectarIntencao('tem em pellets?'), INTERESSES.GRANULADO));
teste('bastao com acento e bastao', () =>
  assert.equal(detectarIntencao('cola em bastão'), INTERESSES.BASTAO));
teste('refil e bastao', () => assert.equal(detectarIntencao('refil de cola'), INTERESSES.BASTAO));
teste('cola sem especificar fica generica', () =>
  assert.equal(detectarIntencao('tem cola hot melt?'), 'cola'));
teste('citou os dois produtos fica generico', () =>
  assert.equal(detectarIntencao('granulada ou bastao?'), 'cola'));
teste('exportacao e outro', () =>
  assert.equal(detectarIntencao('quero falar de exportação'), INTERESSES.OUTRO));
teste('oi e desconhecida', () => assert.equal(detectarIntencao('oi'), 'desconhecida'));

console.log('\n-- primeiro contato --');
teste('"oi" recebe o menu de 3 opcoes', () => {
  const r = rodar(ESTADOS.NOVO, 'oi');
  assert.equal(r.estado, ESTADOS.AGUARDANDO_MENU);
  assert.match(r.resposta, /granulada/);
  assert.match(r.resposta, /Bastão/);
});

teste('cola generica tambem recebe o menu', () => {
  const r = rodar(ESTADOS.NOVO, 'bom dia, voces tem cola hot melt?');
  assert.equal(r.estado, ESTADOS.AGUARDANDO_MENU);
});

teste('quem ja diz granulada pula o menu', () => {
  const r = rodar(ESTADOS.NOVO, 'preciso de cola granulada');
  assert.equal(r.estado, ESTADOS.AGUARDANDO_QTD);
  assert.equal(r.interesse, INTERESSES.GRANULADO);
});

teste('granulado + quantidade alta resolve de primeira', () => {
  const r = rodar(ESTADOS.NOVO, 'preciso de 200kg de cola granulada');
  assert.equal(r.lead.desfecho, 'lead');
  assert.equal(r.lead.interesse, INTERESSES.GRANULADO);
  assert.equal(r.entregarAoHumano, true);
});

console.log('\n-- bastao abaixo do minimo --');
teste('manda os dois links de bastao', () => {
  const r = rodar(ESTADOS.NOVO, 'queria 2kg de bastao de cola quente');
  assert.equal(r.lead.desfecho, 'mercado_livre');
  assert.ok(r.resposta.includes(L11), 'faltou o link do 11mm');
  assert.ok(r.resposta.includes(L74), 'faltou o link do 7,4mm');
  assert.equal(r.entregarAoHumano, false);
});

console.log('\n-- granulado abaixo do minimo --');
teste('NAO manda link de bastao para quem pediu granulado', () => {
  const r = rodar(ESTADOS.NOVO, 'queria 2kg de cola granulada');
  assert.ok(!r.resposta.includes(L11), 'mandou link de bastao para pedido de granulado');
  assert.ok(!r.resposta.includes(L74), 'mandou link de bastao para pedido de granulado');
});

teste('granulado abaixo do minimo vai para atendimento', () => {
  const r = rodar(ESTADOS.NOVO, 'queria 2kg de cola granulada');
  assert.equal(r.lead.desfecho, 'granulado_abaixo_minimo');
  assert.equal(r.entregarAoHumano, true);
  assert.match(r.resposta, /25 kg/);
});

console.log('\n-- menu --');
teste('opcao 1 pergunta a quantidade do granulado', () => {
  const r = rodar(ESTADOS.AGUARDANDO_MENU, '1');
  assert.equal(r.estado, ESTADOS.AGUARDANDO_QTD);
  assert.equal(r.interesse, INTERESSES.GRANULADO);
});

teste('opcao 1 NAO e lida como 1 kg', () => {
  const r = rodar(ESTADOS.AGUARDANDO_MENU, '1');
  assert.equal(r.lead, null);
});

teste('opcao 2 pergunta a quantidade do bastao', () => {
  const r = rodar(ESTADOS.AGUARDANDO_MENU, '2');
  assert.equal(r.estado, ESTADOS.AGUARDANDO_QTD);
  assert.equal(r.interesse, INTERESSES.BASTAO);
});

teste('opcao 2 NAO e lida como 2 kg', () => {
  const r = rodar(ESTADOS.AGUARDANDO_MENU, '2');
  assert.equal(r.lead, null);
});

teste('opcao 3 encerra e chama humano', () => {
  const r = rodar(ESTADOS.AGUARDANDO_MENU, '3');
  assert.equal(r.lead.desfecho, 'outro_assunto');
  assert.equal(r.entregarAoHumano, true);
});

teste('"1" no primeiro contato nao vira 1 kg', () => {
  const r = rodar(ESTADOS.NOVO, '1');
  assert.equal(r.lead, null);
});

teste('cola generica no menu reperguta', () => {
  const r = rodar(ESTADOS.AGUARDANDO_MENU, 'cola hot melt', { tentativas: 0 });
  assert.equal(r.estado, ESTADOS.AGUARDANDO_MENU);
  assert.equal(r.tentativas, 1);
});

teste('na segunda tentativa entrega para humano', () => {
  const r = rodar(ESTADOS.AGUARDANDO_MENU, 'asdfgh', { tentativas: 1 });
  assert.equal(r.entregarAoHumano, true);
  assert.equal(r.lead.desfecho, 'humano');
});

console.log('\n-- quantidade --');
teste('exatamente o minimo conta como lead', () => {
  const r = rodar(ESTADOS.AGUARDANDO_QTD, '25', { interesse: INTERESSES.BASTAO });
  assert.equal(r.lead.desfecho, 'lead');
});

teste('bastao, um abaixo do minimo, vai para o Mercado Livre', () => {
  const r = rodar(ESTADOS.AGUARDANDO_QTD, '24', { interesse: INTERESSES.BASTAO });
  assert.equal(r.lead.desfecho, 'mercado_livre');
});

teste('granulado, um abaixo do minimo, vai para humano', () => {
  const r = rodar(ESTADOS.AGUARDANDO_QTD, '24', { interesse: INTERESSES.GRANULADO });
  assert.equal(r.lead.desfecho, 'granulado_abaixo_minimo');
});

teste('depois do menu, "1" ja vale como 1 kg', () => {
  const r = rodar(ESTADOS.AGUARDANDO_QTD, '1', { interesse: INTERESSES.BASTAO });
  assert.equal(r.lead.desfecho, 'mercado_livre');
});

teste('quantidade ilegivel reperguta', () => {
  const r = rodar(ESTADOS.AGUARDANDO_QTD, 'nao sei ainda', {
    interesse: INTERESSES.GRANULADO,
    tentativas: 0,
  });
  assert.equal(r.estado, ESTADOS.AGUARDANDO_QTD);
  assert.equal(r.tentativas, 1);
});

teste('ilegivel duas vezes vai para humano', () => {
  const r = rodar(ESTADOS.AGUARDANDO_QTD, 'nao sei ainda', {
    interesse: INTERESSES.GRANULADO,
    tentativas: 1,
  });
  assert.equal(r.entregarAoHumano, true);
});

console.log('\n-- silencio --');
teste('encerrado nao responde mais nada', () => {
  assert.equal(rodar(ESTADOS.ENCERRADO, 'oi de novo').resposta, null);
});

teste('ignorado nao responde nada', () => {
  assert.equal(rodar(ESTADOS.IGNORADO, 'oi').resposta, null);
});

console.log(`\n${passou} passaram, ${falhou} falharam\n`);
process.exit(falhou > 0 ? 1 : 0);
