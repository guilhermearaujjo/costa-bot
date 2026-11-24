// Testes do fluxo. Rodam sem banco, sem rede e sem Evolution.
// `npm run teste`

import assert from 'node:assert/strict';
import { processar, ESTADOS, extrairQuantidadeKg, detectarIntencao } from '../src/fluxo.js';

const MINIMO = 25;
const LINK = 'https://exemplo.mercadolivre';

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
    linkMercadoLivre: LINK,
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
teste('opcao 1 e cola', () => assert.equal(detectarIntencao('1'), 'cola'));
teste('opcao 2 e outro', () => assert.equal(detectarIntencao('2'), 'outro'));
teste('hot melt e cola', () => assert.equal(detectarIntencao('tem cola hot melt?'), 'cola'));
teste('granulada e cola', () => assert.equal(detectarIntencao('quero granulada'), 'cola'));
teste('bastao com acento e cola', () => assert.equal(detectarIntencao('cola em bastão'), 'cola'));
teste('exportacao e outro', () => assert.equal(detectarIntencao('quero falar de exportação'), 'outro'));
teste('oi e desconhecida', () => assert.equal(detectarIntencao('oi'), 'desconhecida'));

console.log('\n-- primeiro contato --');
teste('"oi" recebe o menu', () => {
  const r = rodar(ESTADOS.NOVO, 'oi');
  assert.equal(r.estado, ESTADOS.AGUARDANDO_MENU);
  assert.match(r.resposta, /Cola hot melt/);
});

teste('quem ja fala de cola pula o menu', () => {
  const r = rodar(ESTADOS.NOVO, 'bom dia, voces tem cola hot melt?');
  assert.equal(r.estado, ESTADOS.AGUARDANDO_QTD);
  assert.match(r.resposta, /quantidade/i);
});

teste('cola + quantidade alta resolve de primeira', () => {
  const r = rodar(ESTADOS.NOVO, 'preciso de 200kg de cola hot melt granulada');
  assert.equal(r.estado, ESTADOS.ENCERRADO);
  assert.equal(r.lead.desfecho, 'lead');
  assert.equal(r.lead.quantidadeKg, 200);
  assert.equal(r.entregarAoHumano, true);
});

teste('cola + quantidade baixa manda o Mercado Livre de primeira', () => {
  const r = rodar(ESTADOS.NOVO, 'queria 2kg de cola hot melt');
  assert.equal(r.lead.desfecho, 'mercado_livre');
  assert.ok(r.resposta.includes(LINK));
});

console.log('\n-- menu --');
teste('opcao 1 leva a pergunta de quantidade', () => {
  const r = rodar(ESTADOS.AGUARDANDO_MENU, '1');
  assert.equal(r.estado, ESTADOS.AGUARDANDO_QTD);
});

teste('opcao 1 NAO e lida como 1 kg', () => {
  const r = rodar(ESTADOS.AGUARDANDO_MENU, '1');
  assert.equal(r.lead, null);
  assert.ok(!r.resposta.includes(LINK));
});

teste('opcao 1 com ponto tambem nao vira quantidade', () => {
  const r = rodar(ESTADOS.AGUARDANDO_MENU, '1.');
  assert.equal(r.estado, ESTADOS.AGUARDANDO_QTD);
});

teste('"1" no primeiro contato nao vira 1 kg', () => {
  const r = rodar(ESTADOS.NOVO, '1');
  assert.equal(r.lead, null);
});

teste('depois do menu, "1" ja vale como 1 kg', () => {
  const r = rodar(ESTADOS.AGUARDANDO_QTD, '1');
  assert.equal(r.lead.desfecho, 'mercado_livre');
});

teste('opcao 2 encerra e chama humano', () => {
  const r = rodar(ESTADOS.AGUARDANDO_MENU, '2');
  assert.equal(r.estado, ESTADOS.ENCERRADO);
  assert.equal(r.lead.desfecho, 'outro_assunto');
  assert.equal(r.entregarAoHumano, true);
});

teste('resposta sem sentido reperguta uma vez', () => {
  const r = rodar(ESTADOS.AGUARDANDO_MENU, 'asdfgh', { tentativas: 0 });
  assert.equal(r.estado, ESTADOS.AGUARDANDO_MENU);
  assert.equal(r.tentativas, 1);
});

teste('na segunda tentativa entrega para humano', () => {
  const r = rodar(ESTADOS.AGUARDANDO_MENU, 'asdfgh', { tentativas: 1 });
  assert.equal(r.estado, ESTADOS.ENCERRADO);
  assert.equal(r.entregarAoHumano, true);
  assert.equal(r.lead.desfecho, 'humano');
});

console.log('\n-- quantidade --');
teste('exatamente o minimo conta como lead', () => {
  const r = rodar(ESTADOS.AGUARDANDO_QTD, '25');
  assert.equal(r.lead.desfecho, 'lead');
});

teste('um abaixo do minimo vai para o Mercado Livre', () => {
  const r = rodar(ESTADOS.AGUARDANDO_QTD, '24');
  assert.equal(r.lead.desfecho, 'mercado_livre');
});

teste('quantidade ilegivel reperguta', () => {
  const r = rodar(ESTADOS.AGUARDANDO_QTD, 'nao sei ainda', { tentativas: 0 });
  assert.equal(r.estado, ESTADOS.AGUARDANDO_QTD);
  assert.equal(r.tentativas, 1);
});

teste('ilegivel duas vezes vai para humano', () => {
  const r = rodar(ESTADOS.AGUARDANDO_QTD, 'nao sei ainda', { tentativas: 1 });
  assert.equal(r.estado, ESTADOS.ENCERRADO);
  assert.equal(r.entregarAoHumano, true);
});

console.log('\n-- silencio --');
teste('encerrado nao responde mais nada', () => {
  const r = rodar(ESTADOS.ENCERRADO, 'oi de novo');
  assert.equal(r.resposta, null);
});

teste('ignorado nao responde nada', () => {
  const r = rodar(ESTADOS.IGNORADO, 'oi');
  assert.equal(r.resposta, null);
});

console.log(`\n${passou} passaram, ${falhou} falharam\n`);
process.exit(falhou > 0 ? 1 : 0);
