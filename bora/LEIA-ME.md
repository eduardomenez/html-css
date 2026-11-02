# Bora: tarefas sem enrolar

Web app (PWA) para iPhone, pensado para quem procrastina e esquece as coisas do dia a dia.
Abre no Safari e fica na Tela de Início como um app. Funciona sem internet e não tem servidor:
os dados ficam só no celular de cada pessoa.

**Link (depois de publicado no GitHub Pages):** `https://eduardomenez.github.io/html-css/bora/`

## O que ele faz contra a procrastinação

| Recurso | Para quê |
|---|---|
| **Cartão "Agora"** | Mostra **uma** tarefa por vez, com o primeiro passo. Assim não dá aquela paralisia de olhar a lista inteira. |
| **"Começar 5 min"** | Regra dos 5 minutos: basta começar, e no fim ela decide se continua. Também tem 2, 25 (pomodoro) e 50 min. |
| **Passos pequenos** | A tarefa é quebrada em micro-passos e o app só mostra o próximo. |
| **Adiar com consciência** | Para adiar, é preciso escolher *quando*. Depois de 2 adiamentos, o app sugere fazer 2 min, quebrar em passos ou apagar. |
| **Atrasadas primeiro** | O que está atrasado ou é importante sobe para o topo. |
| **Rotina** | Tarefas que repetem (todo dia, dias úteis, semanal), como remédio e skincare. |
| **Água** | Contador de copos, aviso de "faz 2h sem beber" e alarmes diários no calendário. |
| **Sequência 🔥 e confete** | Recompensa imediata ao concluir uma tarefa. |
| **Google Agenda + Tarefas** | Opcional. Mostra a agenda do dia, importa e conclui o Google Tarefas e cria alarmes. |

## Alarmes com o app fechado (importante)

Um web app no iPhone não consegue tocar alarme sozinho com o app fechado. Por isso o Bora
usa o **calendário do celular**, que é quem dispara os alarmes:

- **Sem Google:** ao marcar "Criar alarme", o app gera um arquivo `.ics`. O iPhone abre no
  Calendário: toque em *Adicionar*. O alarme toca na hora e 10 min antes, igual a um evento normal.
- **Com Google conectado:** o app cria o evento direto no Google Agenda com notificação. O alarme
  chega pelo app Google Agenda (ou pelo Calendário do iPhone, se a conta Google estiver adicionada lá).
- **Água:** na aba Água, "Adicionar ao Calendário" cria os lembretes diários (8h, 10h, 12h...).

### Alarme de verdade no Relógio (via app Atalhos)

Um site não consegue criar alarme no Relógio, mas o app **Atalhos** consegue. O Bora chama um
atalho chamado **Bora Alarme** passando `HH:MM|Bora: título da tarefa`, e o atalho cria o alarme
no Relógio. O resultado é um alarme real: tela cheia, toca mesmo no silencioso e é preciso parar
ou adiar.

- Configuração única no iPhone: **Ajustes → ⏰ Alarme do iPhone → Como configurar**. O passo a
  passo aparece dentro do próprio app.
- Depois, ative **"Usar alarme do Relógio nas tarefas"** e toque em **Testar** (cria um alarme
  para daqui a 2 minutos).
- Limites:
  - O alarme do Relógio só tem horário, sem data, então o app só cria alarmes para as **próximas 24h**.
  - A cada alarme criado, o iPhone pula rapidinho para o Atalhos. Para voltar, toque em **◀ Bora**.
  - Tarefas que se repetem ganham alarme só para a próxima vez.
- Parte opcional: uma automação "Quando um alarme for interrompido" apaga os alarmes `Bora:`
  que já tocaram (iOS 17+).
- O nome do atalho pode ser mudado em `config.js` (`shortcutName`) ou em Ajustes.

## Publicar (GitHub Pages)

1. Faça o merge desta branch na `master`.
2. No GitHub: **Settings → Pages → Source: Deploy from a branch → `master` / root**.
3. Em 1 ou 2 minutos o app fica em `https://eduardomenez.github.io/html-css/bora/`.

## Instalar no iPhone

1. Abra o link no **Safari** (não no Chrome).
2. Toque em **Compartilhar** ⬆️ e depois em **Adicionar à Tela de Início**.
3. Abra pelo ícone. No primeiro acesso, o app pergunta o nome.

> Cada iPhone tem os próprios dados. Você pode testar no seu e depois mandar o link para ela:
> ela começa do zero e conecta a conta Google *dela*. Para levar dados de um celular para outro,
> use **Ajustes → Backup → Exportar/Importar**.

## Integração com Google (opcional, ~10 min, feito uma vez só)

O app usa o login do Google direto do navegador (sem servidor). É preciso um **Client ID**:

1. Acesse <https://console.cloud.google.com/> e crie um projeto (ex.: "Bora").
2. **APIs e serviços → Biblioteca:** ative a **Google Calendar API** e a **Google Tasks API**.
3. **APIs e serviços → Tela de consentimento OAuth** (ou "Google Auth Platform"):
   - Tipo **Externo**, nome "Bora", seu e-mail.
   - Escopos: `.../auth/calendar.events` e `.../auth/tasks`.
   - **Usuários de teste:** adicione o seu e-mail **e o dela**. Enquanto o app estiver em
     "Teste", só esses e-mails conseguem entrar. Para uso pessoal não precisa publicar.
4. **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web**:
   - **Origens JavaScript autorizadas:** `https://eduardomenez.github.io`
   - **URIs de redirecionamento autorizados:** `https://eduardomenez.github.io/html-css/bora/`
     (o app mostra o endereço exato em Ajustes → Configuração técnica)
5. Copie o Client ID (`xxxx.apps.googleusercontent.com`) e:
   - **ou** cole em `bora/config.js` → `googleClientId` (vale para todo mundo que abrir o link);
   - **ou** cole no app em **Ajustes → Google → Configuração técnica** (vale só naquele celular).
6. No app: **Ajustes → Conectar conta Google**.

Observações:
- O login dura cerca de 1 hora (limite do modo sem servidor). Depois disso, "Reconectar" é um toque
  e não pede autorização de novo. Os alarmes já criados no Google continuam funcionando normalmente.
- O que sincroniza: a agenda de hoje (só leitura na tela), as tarefas abertas da lista padrão do
  Google Tarefas (importa e marca como concluída nos dois lados) e os alarmes criados pelo app.
- Em modo "Teste", o Google pode pedir login de novo a cada 7 dias.

## Personalizar depois

- `config.js`: nome do app, Client ID e padrões de água.
- `style.css`: cores (variáveis no topo, `--accent` é a cor principal).
- Ao alterar arquivos, aumente a versão em `sw.js` (`bora-v1` → `bora-v2`) para os celulares
  baixarem a versão nova.

## Arquivos

```
bora/
├── index.html            estrutura + meta tags do iPhone
├── style.css             visual (claro/escuro automático)
├── app.js                lógica do app
├── config.js             configurações editáveis
├── manifest.webmanifest  dados de instalação (PWA)
├── sw.js                 funciona offline
└── icons/                ícones da Tela de Início
```
