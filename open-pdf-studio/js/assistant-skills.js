// OpenAEC-assistent skill set.
//
// Each skill is a capability the assistant can perform on the open PDF. Clicking
// a skill chip sends `invoke` as a user message; via the provider chain it reaches
// the brain (Claude Code over the MCP relay, or any AI provider) which executes
// it using the app's MCP tools. SKILLS_SYSTEM_PROMPT teaches the brain how.

export const ASSISTANT_SKILLS = [
  {
    id: 'translate',
    icon: '🌐',
    label: 'Vertaal',
    hint: 'Vertaal de tekst van het document',
    invoke: 'Vertaal de tekst van het geopende document. Is het Nederlands, vertaal dan naar het Engels; anders naar het Nederlands. Geef de vertaling overzichtelijk terug.',
  },
  {
    id: 'summarize',
    icon: '📝',
    label: 'Vat samen',
    hint: 'Vat het document of de tekening samen',
    invoke: 'Vat het geopende document of de tekening bondig samen: waar gaat het over, de belangrijkste onderdelen en eventuele aandachtspunten.',
  },
  {
    id: 'draw',
    icon: '✏️',
    label: 'Teken',
    hint: 'Teken een element of annotatie op de tekening',
    invoke: 'Teken op de tekening: ',
    needsInput: true,
  },
  {
    id: 'detect-doors',
    icon: '🚪',
    label: 'Herken deuren',
    hint: 'Detecteer de deuren in de plattegrond en markeer ze',
    invoke: 'Bekijk de plattegrond, herken de deuren en markeer elke deur op de tekening met een markering en een korte label.',
  },
];

export const SKILLS_SYSTEM_PROMPT =
  'Je beschikt over een vaardigheden-set en kunt ACTIES uitvoeren op het geopende PDF-document via de MCP-tools van de app:\n' +
  '- Vertalen / samenvatten: gebruik app_screenshot_view (width 2000) om de pagina te bekijken en te lezen; geef het resultaat als tekst terug.\n' +
  '- Tekenen: gebruik app_create_annotation. Coordinaten zijn paginapunten op 100% zoom; haal de paginamaat op met app_get_viewport_state (pageW/pageH).\n' +
  '- Deuren herkennen: doe eerst app_fit_page, maak dan app_screenshot_view (width 2000), herken de deuren visueel en markeer elke deur met app_create_annotation (bijvoorbeeld een box of cloud rond de deur + een textbox-label). Reken screenshot-pixels om naar paginapunten via pageW/pageH.\n' +
  'Antwoord in het Nederlands, bondig en praktisch. Voer gevraagde acties direct uit en meld kort wat je gedaan hebt.';
