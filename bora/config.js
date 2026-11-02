/*
 * Configuração do app "Bora".
 * Edite este arquivo para mudar o comportamento padrão — não precisa mexer no resto do código.
 * Tudo aqui também pode ser alterado dentro do app, em Ajustes (cada celular guarda o seu).
 */
window.BORA_CONFIG = {
  // Nome que aparece no topo do app
  appName: 'Bora',

  // Client ID OAuth do Google Cloud (tipo "Aplicativo da Web").
  // Veja o passo a passo no LEIA-ME.md. Deixe vazio para usar o app sem Google.
  // Exemplo: '1234567890-abcdefg.apps.googleusercontent.com'
  googleClientId: '',

  // Nome do atalho do app Atalhos que cria o alarme no Relógio (veja Ajustes → Alarme do iPhone)
  shortcutName: 'Bora Alarme',

  // Água
  waterGoal: 8,        // copos por dia
  glassMl: 250,        // ml por copo
  wake: '08:00',       // acorda
  sleep: '22:00',      // dorme
  waterInterval: 120   // minutos entre lembretes de água
};
