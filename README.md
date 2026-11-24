# costa-bot

Atendimento automático de **primeiro contato** no WhatsApp da Costa & Montenegro.
Sem LLM: é uma máquina de estados com menu numérico e palavras-chave. Resposta previsível, custo zero por mensagem.

## O que ele faz

- Só age em **conversa nova**. Quem já era contato antes da instalação nunca recebe mensagem.
- Pergunta o que a pessoa precisa.
- **Cola acima do mínimo** → confirma e avisa que um atendente vai falar. Lead registrado.
- **Cola abaixo do mínimo** → manda o link do Mercado Livre e encerra.
- **Outro assunto** → pede para aguardar e encerra.
- **Assim que a Eliana responde**, o bot se cala naquele contato para sempre.
- Tudo registrado por número de telefone.

## As quatro travas

Essas são as regras que impedem o bot de fazer besteira. Estão todas em `src/index.js`.

1. **Contato pré-existente** — na instalação a gente congela a lista de chats que já existiam (`POST /admin/congelar-antigos`). Esses ficam com `pre_existente = true` e são ignorados para sempre. É o que impede o bot de disparar para a base inteira.
2. **Grupos e status** — qualquer JID que não termine em `@s.whatsapp.net` é descartado.
3. **Handoff humano** — toda mensagem que o bot envia tem o ID guardado em `mensagens_bot`. Quando chega um evento `fromMe` cujo ID não está lá, foi gente de verdade: o contato é marcado com `atendimento_humano = true` e o bot nunca mais fala ali.
4. **MODO** — em `mudo` nada é enviado, só registrado. É assim que a gente valida tudo antes de uma única mensagem sair.

## Modos de operação

| MODO | O que faz |
|---|---|
| `mudo` | Lê e registra tudo, **não envia nada**. Usar nos primeiros 1–2 dias. |
| `piloto` | Responde só os números em `WHITELIST`. |
| `ativo` | Responde todo contato novo. |

## Ordem de instalação

Não pule etapas, principalmente a 4.

1. **Subir Postgres** e criar o banco.
2. **Subir a Evolution API** com domínio e SSL.
3. **Conectar o número**: ligar verificação em duas etapas no WhatsApp, criar a instância, ler o QR code. Confirmar com a Eliana que o celular dela continua normal.
4. **Subir este serviço com `MODO=mudo`** e apontar o webhook da Evolution (evento `MESSAGES_UPSERT`) para:
   `https://<host-do-bot>/webhook/<WEBHOOK_TOKEN>`
5. **Congelar os contatos antigos**, uma única vez:
   ```
   curl -X POST "https://<host-do-bot>/admin/congelar-antigos?token=<ADMIN_TOKEN>"
   ```
6. **Deixar em modo mudo por 1–2 dias.** Acompanhar em
   `https://<host-do-bot>/admin/eventos?token=<ADMIN_TOKEN>`
   e conferir: contato antigo aparece como `ignorado_contato_pre_existente`, resposta da Eliana aparece como `humano_assumiu`, e as decisões para contatos novos fazem sentido.
7. **`MODO=piloto`** com os números de teste. Rodar os quatro caminhos: acima do mínimo, abaixo, outro assunto, e a Eliana interrompendo no meio.
8. **`MODO=ativo`**.

## Variáveis de ambiente

Estão todas documentadas em `.env.example`. As duas que ainda dependem do cliente:

- `MINIMO_KG` — quantidade que separa lead de Mercado Livre.
- `LINK_MERCADO_LIVRE` — link do anúncio.

O serviço se recusa a subir em `MODO=ativo` sem o link preenchido.

## Rotas

| Rota | Para quê |
|---|---|
| `POST /webhook/:token` | Recebe os eventos da Evolution. |
| `GET /saude` | Checagem de vida, usada pelo EasyPanel. |
| `POST /admin/congelar-antigos` | Congela os contatos pré-existentes. Rodar uma vez. |
| `GET /admin/conexao` | Estado da conexão do número na Evolution. |
| `GET /admin/eventos` | Log das decisões. É o que se lê no modo mudo. |
| `GET /admin/leads.csv` | Exporta os leads. |

As rotas `/admin/*` pedem `?token=<ADMIN_TOKEN>` ou o header `x-admin-token`.

## Textos

Todas as mensagens ficam em `src/textos.js`, separadas do código, para o cliente revisar sem mexer em lógica.

## Testes

```
npm install
npm run teste
```

Os testes do fluxo rodam sem banco, sem rede e sem Evolution.

## Deploy no EasyPanel

App por Dockerfile, apontando para este repositório. Porta 3000. Healthcheck em `/saude`.
Se o limite de projetos estiver estourado, os serviços podem viver dentro de um projeto já existente com o prefixo `costa-`.

Uma única Evolution API atende vários números em instâncias separadas — dá para compartilhar com outros clientes em vez de subir uma por projeto.
