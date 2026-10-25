const english = document.documentElement.lang === 'en-US';
const messages = {
  agent: ['O agente tem um papel, instruções e, se você quiser, provedores vinculados. O harness define como esse trabalho se conecta ao restante.', 'An agent has a role, instructions, and, if you choose, bound providers. The harness defines how its work connects to the rest.'],
  skill: ['A skill reúne conhecimento para uma tarefa: revisar código, desenhar uma interface ou investigar um problema. Ela orienta quem executa.', 'A skill brings together knowledge for a task: reviewing code, designing an interface, or investigating a problem. It guides the agent doing the work.'],
  gate: ['O gate é um checkpoint com critérios explícitos. Ele descreve quando o trabalho pode seguir e quando precisa voltar para revisão.', 'A gate is a checkpoint with explicit criteria. It describes when work can move forward and when it needs another review.'],
  human: ['A autoridade humana faz parte do desenho. Você define onde a automação deve parar para uma decisão sua.', 'Human authority is part of the design. You decide where automation must stop for your input.'],
  zoomRun: ['Execução simulada', 'Mock run'],
  copied: ['Copiado', 'Copied'],
  copyFallback: ['Selecione o código para copiar', 'Select the code to copy'],
  greeting: ['Um olá do Nilo.', 'A hello from Nilo.'],
  thinking: ['Uma ideia tomando forma.', 'An idea taking shape.'],
  working: ['Hora de trabalhar.', 'Time to get to work.'],
  ready: ['Pronto para o próximo passo.', 'Ready for the next step.'],
  next: ['Próxima expressão', 'Next expression'],
  pause: ['Pausar cena', 'Pause scene'],
  resume: ['Continuar cena', 'Resume scene'],
  replay: ['Ver novamente', 'Watch again'],
  reduced: ['Movimento reduzido.', 'Reduced motion.'],
  paused: ['Cena pausada. Continue de onde parou.', 'Scene paused. Resume where you left off.'],
  finished: ['Fim da cena. Até a próxima ideia.', 'End of the scene. See you at the next idea.'],
  loadError: ['Não foi possível carregar a cena.', 'The scene could not be loaded.'],
  retry: ['Tentar novamente', 'Try again'],
};

export const t = key => messages[key][english ? 1 : 0];
export const niloLabel = label => english ? `${label} — Nilo` : `${label} do Nilo`;
