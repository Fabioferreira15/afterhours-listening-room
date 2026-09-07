# Afterhours — Listening room MVP

Nova aplicação independente dentro do repositório Afterhours. O site Discord existente não foi substituído nem publicado por este trabalho.

## Executar

Requer Node 24. Instalar dependências na pasta `listening-room` com `npm ci`.
Copiar `.env.example` para `.env`, configurar os valores e executar:

```sh
npm run build
npm start
```

Abrir `http://localhost:3210`. Para desenvolvimento: `node --env-file-if-exists=.env server/index.mjs --dev`.

Criar uma sala e copiar o convite. O criador mantém a chave de anfitrião em `sessionStorage` nesse separador; os links de convite não incluem essa chave. Um convidado não pode assumir o papel de anfitrião ao enviar comandos. Para este MVP, manter o separador do anfitrião aberto; não há transferência nem recuperação de titularidade.

Cada pessoa entra com nome/cor, clica em **Ativar som** e pode mover o avatar com WASD, setas ou clique. Nos players embutidos pode ser necessário clicar também no player oficial para autorizar a reprodução. O áudio é desativado durante perda da ligação WebSocket e ressincronizado ao reconectar.

## Configurar fontes

- `ADMIN_KEY`: segredo aleatório para o painel ⚙. Nunca enviar aos convidados.
- `TOKEN_ENCRYPTION_KEY`: 32 bytes aleatórios em hexadecimal. Gerar com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Manter estável: protege os tokens Spotify em repouso.
- `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET`: aplicação Spotify de desenvolvimento própria; não reutilizar as credenciais Discord.
- Registar no Spotify a URL exata `PUBLIC_ORIGIN/api/spotify/callback`. Para desenvolvimento Spotify usar uma origem/redirect aceite pelo portal (HTTPS ou loopback IP conforme documentação), e definir `PUBLIC_ORIGIN` de forma correspondente. `localhost` é apenas a origem predefinida do teste local sem Spotify.
- Abrir ⚙, autenticar com `ADMIN_KEY` e autorizar Spotify. OAuth com state vinculado à sessão admin; tokens AES-256-GCM apenas no servidor. Scope: leitura de playlists privadas/colaborativas, sem áudio Spotify.
- `AUDIUS_API_KEY`: quando exigida pelo acesso Audius. O cliente de pesquisa envia `x-api-key`; confirmar o nível de acesso e reprodução da aplicação antes de produção. Pesquisa e streaming público não foram validados contra o serviço real neste ambiente.
- `SOUNDCLOUD_ACCESS_TOKEN`: opcional; permite pesquisa com a API aprovada SoundCloud. Links diretos funcionam com o widget oficial e não dependem desta pesquisa. A renovação deste token ainda é manual.
- `YOUTUBE_API_KEY`: opcional, para obter candidatos de fallback. O anfitrião confirma o vídeo antes de reproduzir. Links de vídeos diretos usam o player oficial sem pesquisa.

Acesso Spotify a playlists depende das permissões da conta e das limitações do modo de desenvolvimento; no modo de desenvolvimento atual, só são disponibilizadas as faixas de playlists que o administrador possui ou em que colabora. Um amigo terá de o adicionar como colaborador para importar essa playlist por esta conta. Importação limitada a 100 faixas por pedido e 200 na fila. Não há scraping nem extração de áudio de YouTube/SoundCloud.

## O que está implementado

- Sala cozy Three.js: sofás, candeeiros, plantas, colunas, projetor e tela CanvasTexture com título, artista, progresso e estado, mais capa quando a fonte permite carregamento entre origens.
- Painel de reprodução com capa, players oficiais visíveis, fila e controlos; os controlos são HTML acessível sobre o mundo 3D.
- Avatares reais por ligação, movimento interpolado, entrada/saída e reconexão.
- WebSockets Node, sessão de host por segredo de sala, validação de origem, limites de carga e frequência.
- Relógio central (`trackId`, `playing`, `position`, `startedAt`, `revision`) e ajuste de offset por ping de menor RTT.
- Play/pause/seek/next autoritativos; convidados podem pesquisar e enviar pedidos por links. Só admin autenticado pode importar através da conta Spotify central.
- Audius primeiro; matching estrito de título/artista/duração ou ISRC. SoundCloud opcional. YouTube e resultados ambíguos requerem aprovação. Faixas indisponíveis são saltadas pelo comando next.
- Sincronização ao entrar a meio; correção a cada 700 ms: desvio >750 ms faz seek, 120–750 ms ajusta ±2,5% no player HTML; abaixo de 120 ms há uma zona neutra. Embeds não recebem ajustes de velocidade.
- Redis para produção com snapshots duráveis e exclusão de segunda instância; SQLite local sem Redis para testar. Uma única instância Node é o árbitro. Não existe suporte multi-réplica/pubsub neste MVP.

## Limites a validar antes de publicar

Os testes automáticos verificam o protocolo com três clientes WebSocket reais, não o áudio real em três browsers. Não garantimos sincronização à amostra/milissegundo. Publicidade, buffering, permissões, versões diferentes e APIs dos players embutidos podem introduzir desvios. Uma falha local de áudio apresenta erro; não salta a fila de todos por causa de um único cliente. O host decide saltar.

Faixas sem duração conhecida dependem do evento de fim recebido pelo browser do host para avançar. Reabrir o browser do host depois de perder a sessão não recupera controlo automaticamente.

Sem áudio espacial nem votação nesta versão. A tela 3D mostra texto/progresso e capa quando disponível; o player oficial permanece visível no painel do projetor, não como uma textura de vídeo em Three.js. Nenhuma faixa de demonstração é apresentada como uma correspondência real.

## Alojamento

O alojamento Sites atual é Cloudflare Workers; este servidor Node não pode ser publicado lá como se fosse o Worker existente. Usar um serviço/container Node que aceite WebSocket, uma única réplica e Redis persistente. O Dockerfile serve o frontend compilado e a API no mesmo domínio. O `compose.yaml` prepara a app e Redis persistente com `docker compose up --build -d` depois de preencher `.env`; o Redis não expõe portas públicas. Configurar HTTPS, `PUBLIC_ORIGIN`, Redis e credenciais como segredos do serviço. Um proxy deve suportar Upgrade e ligações WebSocket longas.

Para o MVP gratuito no Render, `render.yaml` cria uma única instância com `ALLOW_EPHEMERAL=true`. As salas mantêm-se durante a execução, mas podem desaparecer quando a instância gratuita reinicia ou adormece. O Client ID Spotify é público; o Client Secret continua exclusivamente nas variáveis secretas do Render.

Não há URL nova publicada. A aplicação Spotify, Redis e o alojamento Node ainda precisam de ser configurados pelo proprietário.

## Testes

```sh
node --test tests/*.test.mjs
npm run build
```

Casos: relógio/pause/seek, fila que ignora indisponíveis, zona neutra de drift, proteção contra correspondências erradas, validação de URLs, três clientes WebSocket, host/convidado, late join e limites de posição do avatar.
