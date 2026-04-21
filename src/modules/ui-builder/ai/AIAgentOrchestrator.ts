import { localModelProvider } from '@/execution/llm/LocalModelProvider';
import { ChatMessage } from '@/core/interfaces/IModelProvider';
import { uiBuilderTools } from './AITools';
import { EditorAPI } from '../core/EditorAPI';
import { useUIBuilderStore } from '../store';
import { imageDesignOrchestrator } from './ImageDesignOrchestrator';
import type { VisionAnalysisResult, VisionDesignAnalysis } from '@/core/interfaces/IVisionModelProvider';

export type AgentStatus = 'idle' | 'analyzing' | 'acting' | 'error';

export interface AIResponse {
  role: 'assistant' | 'tool';
  content: string;
  metadata?: any;
}

interface UIPlanComponent {
  id: string;
  type: string;
  name: string;
  purpose: string;
  text?: string;
  bounds?: { x: number; y: number; width: number; height: number };
}

interface UIPlanSection {
  id: string;
  name: string;
  role: string;
  purpose: string;
  bounds?: { x: number; y: number; width: number; height: number };
  components: UIPlanComponent[];
}

interface UIPlanStage {
  id: string;
  title: string;
  goal: string;
  sections: UIPlanSection[];
}

interface UIExecutionPlan {
  screenType: string;
  summary: string;
  strategy: string[];
  stages: UIPlanStage[];
}

export class AIAgentOrchestrator {
  private history: ChatMessage[] = [];
  private onMessageHbs = new Set<(msg: AIResponse) => void>();
  private onStatusChangeHbs = new Set<(status: AgentStatus) => void>();
  private readonly recentTurnLimit = 4;
  private readonly maxChildrenPerNode = 6;
  private readonly maxTextNodes = 24;
  private readonly maxImageComponents = 8;
  
  private status: AgentStatus = 'idle';

  constructor() {
    this.history.push({
      role: 'system',
      content: this.getSystemPrompt()
    });
  }

  private setStatus(status: AgentStatus) {
    this.status = status;
    this.onStatusChangeHbs.forEach(cb => cb(status));
  }

  onMessage(cb: (msg: AIResponse) => void) {
    this.onMessageHbs.add(cb);
    return () => this.onMessageHbs.delete(cb);
  }

  onStatusChange(cb: (status: AgentStatus) => void) {
    this.onStatusChangeHbs.add(cb);
    return () => this.onStatusChangeHbs.delete(cb);
  }

  private emitMessage(msg: AIResponse) {
    this.onMessageHbs.forEach(cb => cb(msg));
  }

  private getSystemPrompt(): string {
    const toolsDescription = uiBuilderTools.map(t => 
      `Tool: ${t.name}\nDescription: ${t.description}\nArgs: ${JSON.stringify(t.parameters)}\n`
    ).join('\n');

    return `You are the UI Builder Design Agent. Your goal is to help the user build beautiful, professional UIs dynamically.
You have access to tools that modify the canvas.

DOMAIN KNOWLEDGE:
- The UI is a tree of nodes. Every node has an \`id\`, \`name\`, \`type\`, \`x\`, \`y\`, \`width\`, \`height\`, and \`children\`.
- Valid Node Types & Properties:
  - "FRAME", "GROUP": Structured containers for other elements.
  - "TEXT": Uses \`content\` (the string) and \`textColor\` properties.
  - "RECTANGLE": Uses \`bgColor\` property.
  - "IMAGE", "VIDEO": Uses \`src\` property for URLs.
- Capabilities:
  - Build UI using \`create_element\`.
  - Resize/Move using \`update_layout\`.
  - Remove elements using \`delete_element\`.
  - Style visually using \`update_style\` with "Decorators" instead of CSS.
- Valid Decorator Types for \`update_style\`:
  - "background": uses \`{ "color": "#hexcode" }\`
  - "text-color": uses \`{ "color": "#hexcode" }\`
  - "text-align": uses \`{ "align": "left" | "center" | "right", "verticalAlign": "top" | "middle" | "bottom" }\`
  - "style": uses \`{ "opacity": 100, "blur": 0, "shadowEnabled": true, "shadow": { "x":0, "y":4, "blur":10, "color": "rgba(0,0,0,0.1)" } }\`
  - "source": uses \`{ "url": "https://..." }\` for IMAGE or VIDEO nodes

HOW TO USE TOOLS:
To generate actions, you MUST reply EXACTLY with a JSON block containing an "actions" array. Each action is a tool call.
\`\`\`json
{
  "actions": [
    {
      "name": "tool_name",
      "args": {
        "param1": "value1"
      }
    }
  ]
}
\`\`\`
Do not write anything else in the message. The Orchestrator will execute these actions together in one batch.

GENERAL INSTRUCTIONS:
1. Context Assessment: Always refer to the "SELECTED NODE IDs" to determine the target of a user's styling/layout instructions.
2. Batching: You can output multiple actions in the array to accomplish the task in one shot.
3. Formatting: ONLY output the JSON array.
4. Text edits: If the user says "change X to Y", target the text node whose CURRENT content matches X most closely. Do not rename a different nearby label just because it is in a similar card.
5. Image-guided edits: When an image is attached, use the screenshot to disambiguate which visible element the user means, but still cross-check against the current canvas text/node data before choosing a nodeId.
6. Text replacement requests: If the user asks to rename, replace, or change visible text, use a single \`update_style\` action with \`decoratorType: "text"\` and \`configValues: { "content": "New Text" }\`. Do NOT use \`text-color\` unless the user explicitly mentions color.
7. Nested creation: If you create a new parent and then need to place children inside it in the same batch, give the parent a \`tempId\` and let later \`create_element\` actions use \`parentRef\` with that same value. Do not guess a future node id and do not use the display name as \`parentId\`.
8. Same-batch references: If you need to update, move, style, or delete a node that you created earlier in the same batch, give that node a \`tempId\` when creating it and use \`nodeRef\` in later actions. Do not invent fake ids such as "header-text-node-id".

EXAMPLE PATTERN (DO NOT COPY BLINDLY):
Context: SELECTED NODE IDs: ["node-123"]
User Request: "Change the background to blue and make it wider"
Assistant:
\`\`\`json
{
  "actions": [
    {
      "name": "update_style",
      "args": { "nodeId": "node-123", "decoratorType": "background", "configValues": { "color": "#2563eb" } }
    },
    {
      "name": "update_layout",
      "args": { "nodeId": "node-123", "width": 800 }
    }
  ]
}
\`\`\`

AVAILABLE TOOLS:
${toolsDescription}`;
  }

  private getDocumentContext(): string {
    const state = useUIBuilderStore.getState();
    const layout = state.document.layouts.find(l => l.id === state.activeLayoutId);
    const page = layout?.pages.find(p => p.id === state.activePageId);
    
    const simplifyNode = (n: any): any => {
      const simplified: Record<string, unknown> = {
        id: n.id,
        name: n.name,
        type: n.type,
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.height,
      };

      if (n.type === 'TEXT' && typeof n.content === 'string') {
        simplified.content = this.truncate(n.content, 80);
      }

      if (Array.isArray(n.children) && n.children.length > 0) {
        simplified.childCount = n.children.length;
        simplified.children = n.children
          .slice(0, this.maxChildrenPerNode)
          .map((child: any) => simplifyNode(child));
      }

      return simplified;
    };

    return JSON.stringify(page?.nodes.map(simplifyNode) || []);
  }

  private getTextNodeContext(): string {
    const state = useUIBuilderStore.getState();
    const layout = state.document.layouts.find(l => l.id === state.activeLayoutId);
    const page = layout?.pages.find(p => p.id === state.activePageId);
    const textNodes: Array<Record<string, unknown>> = [];

    const visit = (node: any, parent?: any) => {
      if (node.type === 'TEXT') {
        textNodes.push({
          id: node.id,
          content: this.truncate(typeof node.content === 'string' ? node.content : '', 80),
          parentName: parent?.name ?? null,
          x: node.x,
          y: node.y,
        });
      }
      node.children?.forEach((child: any) => visit(child, node));
    };

    page?.nodes.forEach((node) => visit(node));
    return JSON.stringify(textNodes.slice(0, this.maxTextNodes));
  }

  private truncate(value: string, maxLength: number): string {
    if (!value) return '';
    return value.length > maxLength
      ? `${value.slice(0, Math.max(0, maxLength - 3))}...`
      : value;
  }

  private summarizeHistory(messages: ChatMessage[]): ChatMessage | null {
    if (messages.length === 0) return null;

    const lines = messages.map((message, index) => {
      const label = message.role === 'assistant' ? 'assistant' : 'user';
      return `${index + 1}. ${label}: ${this.truncateHistoryMessage(message, 140)}`;
    });

    return {
      role: 'assistant',
      content: `PREVIOUS CONVERSATION SUMMARY:\n${lines.join('\n')}`
    };
  }

  private truncateHistoryMessage(message: ChatMessage, maxLength = 220): string {
    const parsed = message.role === 'assistant' ? this.parseActionResponse(message.content) : null;
    if (parsed?.actions?.length) {
      const actionSummary = parsed.actions
        .slice(0, 3)
        .map((action: any) => {
          const nodeId = action?.args?.nodeId ? ` on ${action.args.nodeId}` : '';
          return `${action?.name ?? 'unknown'}${nodeId}`;
        })
        .join(', ');
      return this.truncate(`planned actions: ${actionSummary}`, maxLength);
    }

    return this.truncate(message.content.replace(/\s+/g, ' ').trim(), maxLength);
  }

  private buildCompactExecutionHistory(): ChatMessage[] {
    const systemMessage = this.history[0];
    const conversation = this.history.slice(1);
    const recentMessages = conversation.slice(-this.recentTurnLimit);
    const olderMessages = conversation.slice(0, -this.recentTurnLimit);
    const compactHistory: ChatMessage[] = [systemMessage];

    const historySummary = this.summarizeHistory(olderMessages);
    if (historySummary) {
      compactHistory.push(historySummary);
    }

    recentMessages.forEach((message) => {
      compactHistory.push({
        ...message,
        content: this.truncateHistoryMessage(message, message.role === 'assistant' ? 180 : 220)
      });
    });

    return compactHistory;
  }

  private compressImageAnalysis(structured: unknown): Record<string, unknown> {
    if (!structured || typeof structured !== 'object') {
      return {};
    }

    const data = structured as Record<string, any>;
    const components = Array.isArray(data.components)
      ? data.components.slice(0, this.maxImageComponents).map((component: Record<string, any>) => ({
          type: component.type,
          label: component.label,
          text: this.truncate(typeof component.text === 'string' ? component.text : '', 60),
          bounds: component.bounds,
        }))
      : undefined;

    return {
      screenType: data.screenType,
      summary: this.truncate(typeof data.summary === 'string' ? data.summary : '', 180),
      layoutNotes: Array.isArray(data.layoutNotes)
        ? data.layoutNotes.slice(0, 4).map((note: unknown) => this.truncate(String(note), 80))
        : undefined,
      style: data.style,
      components,
      sections: Array.isArray(data.sections)
        ? data.sections.slice(0, 6).map((section: Record<string, any>) => ({
            name: section.name,
            role: section.role,
            bounds: section.bounds,
          }))
        : undefined,
      cards: Array.isArray(data.cards)
        ? data.cards.slice(0, 6).map((card: Record<string, any>) => ({
            title: this.truncate(typeof card.title === 'string' ? card.title : '', 50),
            subtitle: this.truncate(typeof card.subtitle === 'string' ? card.subtitle : '', 60),
            section: card.section,
            bounds: card.bounds,
          }))
        : undefined,
      textSeen: Array.isArray(data.textSeen)
        ? data.textSeen.slice(0, 10).map((entry: Record<string, any>) => ({
            text: this.truncate(typeof entry.text === 'string' ? entry.text : '', 60),
            section: entry.section,
          }))
        : undefined,
    };
  }

  private getImageAnalysisPrompt(userPrompt: string): string {
    return [
      'Analyze this UI screenshot as structured design reference context for a browser-based editor agent.',
      'Return concise JSON using the requested schema only.',
      'Focus on: screen type, major sections, visible cards, visible text, likely reusable components, and approximate bounds.',
      'Prefer a few high-signal sections and components over exhaustive detail.',
      `User goal: ${userPrompt}`,
    ].join(' ');
  }

  private summarizePlan(plan: UIExecutionPlan): string {
    const stageSummary = plan.stages
      .slice(0, 4)
      .map((stage, index) => `${index + 1}. ${stage.title}: ${stage.goal}`)
      .join('\n');

    return [
      `Planned ${plan.stages.length} stage${plan.stages.length === 1 ? '' : 's'} for ${plan.screenType || 'the referenced screen'}.`,
      plan.summary ? `Summary: ${plan.summary}` : '',
      stageSummary ? `Stages:\n${stageSummary}` : '',
    ].filter(Boolean).join('\n');
  }

  private isValidPlan(value: unknown): value is UIExecutionPlan {
    if (!value || typeof value !== 'object') return false;
    const plan = value as Record<string, any>;
    return typeof plan.screenType === 'string'
      && typeof plan.summary === 'string'
      && Array.isArray(plan.strategy)
      && Array.isArray(plan.stages)
      && plan.stages.length > 0;
  }

  private parsePlanResponse(text: string): UIExecutionPlan | null {
    const candidates = this.buildJsonCandidates(text);

    for (const candidate of candidates) {
      const parsed = this.tryParseGenericCandidate<UIExecutionPlan>(candidate);
      if (this.isValidPlan(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private tryParseGenericCandidate<T>(candidate: string): T | null {
    const normalized = this.normalizeJsonCandidate(candidate);
    const attempts = [normalized, this.removeTrailingCommas(normalized), this.balanceJson(normalized)];

    for (const attempt of attempts) {
      if (!attempt) continue;
      try {
        return JSON.parse(attempt) as T;
      } catch {
        continue;
      }
    }

    return null;
  }

  private getPlanningPrompt(
    prompt: string,
    imageAnalyses: VisionAnalysisResult[],
    selectedStr: string,
    focusedTextReplacementContext: string
  ): string {
    const imageContext = imageAnalyses
      .map((imageAnalysis, index) => {
        const fileLabel = `IMAGE ${index + 1}`;
        const structuredContext = imageAnalysis.structured
          ? JSON.stringify(this.compressImageAnalysis(imageAnalysis.structured))
          : this.truncate(imageAnalysis.rawText, 220);
        return `${fileLabel}:\n${structuredContext}`;
      })
      .join('\n\n');

    return [
      'You are planning screenshot-to-UI reconstruction for a browser-based editor.',
      'Return ONLY valid JSON in this exact shape:',
      '{',
      '  "screenType": "short label",',
      '  "summary": "1-2 sentence summary",',
      '  "strategy": ["short rule", "short rule"],',
      '  "stages": [',
      '    {',
      '      "id": "stage-1",',
      '      "title": "short stage title",',
      '      "goal": "short goal",',
      '      "sections": [',
      '        {',
      '          "id": "section-id",',
      '          "name": "section name",',
      '          "role": "header|summary|grid|navigation|content|card|other",',
      '          "purpose": "what this section should accomplish",',
      '          "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 },',
      '          "components": [',
      '            {',
      '              "id": "component-id",',
      '              "type": "frame|group|rectangle|text|image|input|button|icon|card|other",',
      '              "name": "component name",',
      '              "purpose": "why it exists",',
      '              "text": "visible text if any",',
      '              "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 }',
      '            }',
      '          ]',
      '        }',
      '      ]',
      '    }',
      '  ]',
      '}',
      'Rules:',
      '- Break work into 2-4 small stages.',
      '- Stage 1 should only create or refine the largest structural containers.',
      '- Later stages should populate sections with children and text.',
      '- Prefer create/update work; do not plan delete unless the user explicitly asked to remove something.',
      '- Keep section/component lists concise and high signal.',
      `CURRENT PAGE NODES:\n${this.getDocumentContext()}`,
      `CURRENT TEXT NODES:\n${this.getTextNodeContext()}`,
      `SELECTED NODE IDs: ${selectedStr}`,
      focusedTextReplacementContext ? focusedTextReplacementContext : '',
      `IMAGE ANALYSIS:\n${imageContext}`,
      `USER REQUEST:\n${prompt}`,
    ].filter(Boolean).join('\n\n');
  }

  private getStageActionPrompt(
    prompt: string,
    plan: UIExecutionPlan,
    stage: UIPlanStage,
    selectedStr: string,
    focusedTextReplacementContext: string
  ): string {
    return [
      `CURRENT PAGE NODES:\n${this.getDocumentContext()}`,
      `CURRENT TEXT NODES:\n${this.getTextNodeContext()}`,
      `SELECTED NODE IDs: ${selectedStr}`,
      focusedTextReplacementContext ? focusedTextReplacementContext : '',
      `SCREEN PLAN SUMMARY:\n${JSON.stringify({
        screenType: plan.screenType,
        summary: plan.summary,
        strategy: plan.strategy.slice(0, 4),
      })}`,
      `CURRENT STAGE:\n${JSON.stringify(stage)}`,
      'USER REQUEST:',
      prompt,
      [
        'Generate ONLY valid JSON with an "actions" array.',
        'Prefer create_element, update_layout, and update_style.',
        'Do not delete anything unless the user explicitly asked for removal.',
        'Create the largest containers first, then children for this stage only.',
        'If a node created in this batch is referenced later, use tempId on creation.',
        'Use parentRef only when it matches a tempId created earlier in this same actions array.',
        'Use nodeRef only when it matches a tempId created earlier in this same actions array.',
        'For existing nodes already on the canvas, use real existing nodeId values from the current page context.',
        'Keep the actions focused on the current stage only.',
      ].join(' ')
    ].filter(Boolean).join('\n\n');
  }

  private async generatePlan(prompt: string, imageAnalyses: VisionAnalysisResult[]): Promise<UIExecutionPlan> {
    const selectedStr = this.getSelectedNodeSummary();
    const focusedTextReplacementContext = this.getFocusedTextReplacementContext(prompt);
    const planningMessages: ChatMessage[] = [
      { role: 'system', content: 'You are a UI planning assistant that returns only valid JSON.' },
      {
        role: 'user',
        content: this.getPlanningPrompt(prompt, imageAnalyses, selectedStr, focusedTextReplacementContext),
      },
    ];

    let planResponse = '';
    await localModelProvider.generateStream(planningMessages, (token) => {
      planResponse += token;
    }, { maxTokens: 900, temperature: 0.1 });

    const parsedPlan = this.parsePlanResponse(planResponse);
    if (!parsedPlan) {
      throw new Error('Planner did not return a valid UI plan.');
    }

    return parsedPlan;
  }

  private getSelectedNodeSummary(): string {
    const state = useUIBuilderStore.getState();
    return state.selectedNodeIds.length > 0 ? JSON.stringify(state.selectedNodeIds) : 'None';
  }

  private async executePlanStages(
    prompt: string,
    plan: UIExecutionPlan,
    onAssistantResponse: (assistantResponse: string) => void
  ): Promise<void> {
    const stagesToRun = plan.stages.slice(0, 3);
    const selectedStr = this.getSelectedNodeSummary();
    const focusedTextReplacementContext = this.getFocusedTextReplacementContext(prompt);

    for (const stage of stagesToRun) {
      const executionHistory = this.buildCompactExecutionHistory();
      executionHistory.push({
        role: 'user',
        content: this.getStageActionPrompt(prompt, plan, stage, selectedStr, focusedTextReplacementContext),
      });

      this.emitMessage({ role: 'assistant', content: `Planning actions for ${stage.title}...` });
      const executed = await this.generateAndExecute(executionHistory, onAssistantResponse);
      if (!executed || this.status === 'error') {
        return;
      }
    }
  }

  private extractTextReplacement(prompt: string): { from: string; to: string } | null {
    const normalizedPrompt = prompt.trim();
    const patterns = [
      /change\s+(?:the\s+name|the\s+text|text|name)?\s*from\s+["']?(.+?)["']?\s+to\s+["']?(.+?)["']?$/i,
      /rename\s+["']?(.+?)["']?\s+to\s+["']?(.+?)["']?$/i,
      /replace\s+["']?(.+?)["']?\s+with\s+["']?(.+?)["']?$/i,
    ];

    for (const pattern of patterns) {
      const match = normalizedPrompt.match(pattern);
      if (match?.[1] && match?.[2]) {
        return {
          from: match[1].trim(),
          to: match[2].trim(),
        };
      }
    }

    return null;
  }

  private getFocusedTextReplacementContext(prompt: string): string {
    const replacement = this.extractTextReplacement(prompt);
    if (!replacement) {
      return '';
    }

    const state = useUIBuilderStore.getState();
    const layout = state.document.layouts.find(l => l.id === state.activeLayoutId);
    const page = layout?.pages.find(p => p.id === state.activePageId);
    const candidates: Array<Record<string, unknown>> = [];
    const target = replacement.from.toLowerCase();

    const visit = (node: any, parent?: any) => {
      if (node.type === 'TEXT') {
        const content = typeof node.content === 'string' ? node.content : '';
        if (content.toLowerCase().includes(target)) {
          candidates.push({
            id: node.id,
            content: this.truncate(content, 80),
            parentName: parent?.name ?? null,
            x: node.x,
            y: node.y,
          });
        }
      }
      node.children?.forEach((child: any) => visit(child, node));
    };

    page?.nodes.forEach((node) => visit(node));

    const focusedCandidates = candidates.slice(0, 8);
    return [
      `TEXT REPLACEMENT INTENT: replace "${replacement.from}" with "${replacement.to}"`,
      `For this request, prefer a single update_style action with decoratorType "text" and configValues.content set to "${replacement.to}".`,
      `MATCHING TEXT NODE CANDIDATES:\n${JSON.stringify(focusedCandidates)}`,
    ].join('\n');
  }

  async submitPrompt(prompt: string): Promise<void> {
    if (!localModelProvider.isReady()) {
      await localModelProvider.initialize();
    }

    this.setStatus('analyzing');
    this.emitMessage({ role: 'assistant', content: `Analyzing: "${prompt}"...` });

    // We only push the raw, short prompt into persistent history so the token
    // window doesn't explode over multiple turns.
    this.history.push({ role: 'user', content: prompt });

    // Dynamically inject the massive document context ONLY into the final volatile array sent to the LLM.
    const executionHistory = this.buildCompactExecutionHistory();
    const lastMsgIndex = executionHistory.length - 1;
    
    const state = useUIBuilderStore.getState();
    const selectedStr = state.selectedNodeIds.length > 0 ? JSON.stringify(state.selectedNodeIds) : "None";
    const focusedTextReplacementContext = this.getFocusedTextReplacementContext(prompt);
    
    executionHistory[lastMsgIndex] = {
      role: 'user',
      content:
        `CURRENT PAGE NODES:\n${this.getDocumentContext()}\n\n` +
        `CURRENT TEXT NODES:\n${this.getTextNodeContext()}\n\n` +
        `SELECTED NODE IDs: ${selectedStr}\n\n` +
        (focusedTextReplacementContext ? `${focusedTextReplacementContext}\n\n` : '') +
        `USER REQUEST: ${prompt}`
    };

    await this.generateAndExecute(executionHistory, assistantResponse => {
      this.history.push({ role: 'assistant', content: assistantResponse });
    });
  }

  async submitPromptWithImageContext(prompt: string, imageFiles: File[]): Promise<void> {
    if (!localModelProvider.isReady()) {
      await localModelProvider.initialize();
    }

    this.setStatus('analyzing');
    this.emitMessage({ role: 'assistant', content: `Analyzing ${imageFiles.length} attached image${imageFiles.length > 1 ? 's' : ''} for: "${prompt}"...` });

    const imageAnalyses = await imageDesignOrchestrator.analyzeFiles(
      imageFiles,
      this.getImageAnalysisPrompt(prompt)
    );

    this.history.push({ role: 'user', content: `${prompt}\n\n[Attached image reference count: ${imageFiles.length}]` });

    const plan = await this.generatePlan(prompt, imageAnalyses);
    this.emitMessage({ role: 'assistant', content: this.summarizePlan(plan) });

    await this.executePlanStages(prompt, plan, assistantResponse => {
      this.history.push({ role: 'assistant', content: assistantResponse });
    });
  }

  private async generateAndExecute(
    executionHistory: ChatMessage[],
    onAssistantResponse: (assistantResponse: string) => void
  ): Promise<boolean> {
    try {
      let assistantResponse = '';
      const responsePromise = localModelProvider.generateStream(executionHistory, (token) => {
        assistantResponse += token;
      }, { maxTokens: 1024, temperature: 0.1 });
      
      await responsePromise;
      onAssistantResponse(assistantResponse);

      const parsed = this.parseActionResponse(assistantResponse);
      if (parsed?.actions && Array.isArray(parsed.actions)) {
        this.emitMessage({ role: 'assistant', content: `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\`` });
        this.setStatus('acting');
        this.emitMessage({ role: 'assistant', content: `Executing ${parsed.actions.length} actions in transaction...` });
        
        await this.executeTransactionBatch(parsed.actions);
        this.setStatus('idle');
        return true;
      }
      
      // If we got here, no actions were found.
      this.setStatus('idle');
      this.emitMessage({ role: 'assistant', content: 'No valid actions generated. Try again.' });
      return false;

    } catch (e) {
      this.setStatus('error');
      this.emitMessage({ role: 'assistant', content: `Agent Error: ${(e as Error).message}` });
      return false;
    }
  }

  private parseActionResponse(text: string): { actions: any[] } | null {
    const candidates = this.buildJsonCandidates(text);

    for (const candidate of candidates) {
      const parsed = this.tryParseCandidate(candidate);
      if (parsed?.actions && Array.isArray(parsed.actions)) {
        return parsed;
      }
    }

    return null;
  }

  private buildJsonCandidates(text: string): string[] {
    const candidates = new Set<string>();
    const trimmed = text.trim();

    if (trimmed) {
      candidates.add(trimmed);
      candidates.add(this.stripMarkdownFences(trimmed));
    }

    const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i) || trimmed.match(/```\s*([\s\S]*?)\s*```/);
    if (fencedMatch?.[1]) {
      candidates.add(fencedMatch[1].trim());
    }

    const actionsObject = trimmed.match(/\{[\s\S]*"actions"[\s\S]*\}/);
    if (actionsObject?.[0]) {
      candidates.add(actionsObject[0].trim());
    }

    const actionsArray = trimmed.match(/\[[\s\S]*\]/);
    if (actionsArray?.[0]) {
      candidates.add(`{"actions": ${actionsArray[0].trim()}}`);
    }

    return Array.from(candidates).filter(Boolean);
  }

  private tryParseCandidate(candidate: string): { actions: any[] } | null {
    const normalized = this.normalizeJsonCandidate(candidate);
    const attempts = [normalized, this.removeTrailingCommas(normalized), this.balanceJson(normalized)];

    for (const attempt of attempts) {
      if (!attempt) continue;
      try {
        return JSON.parse(attempt) as { actions: any[] };
      } catch {
        continue;
      }
    }

    return null;
  }

  private stripMarkdownFences(text: string): string {
    return text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  private normalizeJsonCandidate(text: string): string {
    return this.stripMarkdownFences(text)
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/^\s*json\s*/i, '')
      .trim();
  }

  private removeTrailingCommas(text: string): string {
    return text.replace(/,\s*([}\]])/g, '$1');
  }

  private balanceJson(text: string): string {
    const openCurly = (text.match(/\{/g) || []).length;
    const closeCurly = (text.match(/\}/g) || []).length;
    const openSquare = (text.match(/\[/g) || []).length;
    const closeSquare = (text.match(/\]/g) || []).length;

    let balanced = this.removeTrailingCommas(text);
    if (openSquare > closeSquare) {
      balanced += ']'.repeat(openSquare - closeSquare);
    }
    if (openCurly > closeCurly) {
      balanced += '}'.repeat(openCurly - closeCurly);
    }
    return balanced;
  }

  private async executeTransactionBatch(actions: any[]): Promise<void> {
    const state = useUIBuilderStore.getState();
    const locksToRelease = new Set<string>();
    const snapshot = new Map<string, any>();
    const newlyCreatedIds: string[] = [];
    const tempNodeRefs = new Map<string, string>();

    const resolveActionArgs = (actionArgs: Record<string, any> | undefined): Record<string, any> | undefined => {
      if (!actionArgs) return actionArgs;

      const resolvedArgs = { ...actionArgs };
      if (typeof resolvedArgs.nodeRef === 'string') {
        const resolvedNodeId = tempNodeRefs.get(resolvedArgs.nodeRef);
        if (!resolvedNodeId) {
          throw new Error(`Temporary node reference ${resolvedArgs.nodeRef} not found.`);
        }
        resolvedArgs.nodeId = resolvedNodeId;
      } else if (typeof resolvedArgs.nodeId === 'string' && tempNodeRefs.has(resolvedArgs.nodeId)) {
        resolvedArgs.nodeId = tempNodeRefs.get(resolvedArgs.nodeId);
      }

      if (typeof resolvedArgs.parentRef === 'string') {
        const resolvedParentId = tempNodeRefs.get(resolvedArgs.parentRef);
        if (!resolvedParentId) {
          throw new Error(`Temporary parent reference ${resolvedArgs.parentRef} not found.`);
        }
        resolvedArgs.parentId = resolvedParentId;
      } else if (typeof resolvedArgs.parentId === 'string' && tempNodeRefs.has(resolvedArgs.parentId)) {
        resolvedArgs.parentId = tempNodeRefs.get(resolvedArgs.parentId);
      }

      return resolvedArgs;
    };

    // Phase 1: Identify all targeted nodes and acquire locks.
    for (const action of actions) {
      if (action.args?.nodeId) {
        locksToRelease.add(action.args.nodeId);
      }
      if (action.args?.parentId) {
        locksToRelease.add(action.args.parentId);
      }
    }
    
    // Acquire locks and snapshot original state
    for (const id of locksToRelease) {
      EditorAPI.requestNodeLock(id);
      const node = state.findNode(id);
      if (node) {
        // Deep clone the node to serve as a backup if we need to rollback
        snapshot.set(id, JSON.parse(JSON.stringify(node)));
      }
    }

    try {
      // Phase 2: Execute
      for (const action of actions) {
        const { name } = action;
        const args = resolveActionArgs(action.args);
        const tool = uiBuilderTools.find(t => t.name === name);
        if (!tool) throw new Error(`Tool ${name} not found`);

        this.emitMessage({ role: 'tool', content: `Executing: ${name}` });
        const result = await tool.execute(args);
        
        // If a tool dynamically creates a node, track it for rollback deletion if a later step fails.
        if (result && result.id) {
          newlyCreatedIds.push(result.id);
        }

        if (name === 'create_element' && typeof action.args?.tempId === 'string' && result?.id) {
          tempNodeRefs.set(action.args.tempId, result.id);
        }
      }

      this.emitMessage({ role: 'assistant', content: `Transaction completed successfully.` });

    } catch (error: any) {
      this.emitMessage({ role: 'tool', content: `Transaction Failed. Rolling back! (${error.message})` });
      
      // Phase 3: Rollback!
      // Delete any nodes that were dynamically created
      for (const newId of newlyCreatedIds) {
        EditorAPI.deleteNode(newId);
      }
      
      // Restore backups for existing nodes
      for (const [id, backupNode] of snapshot.entries()) {
        if (state.findNode(id)) {
           EditorAPI.updateNode(id, backupNode);
        }
      }
    } finally {
      // Phase 4: Release all locks
      for (const id of locksToRelease) {
        EditorAPI.releaseNodeLock(id);
      }
    }
  }

  clearHistory() {
    this.history = [{
      role: 'system',
      content: this.getSystemPrompt()
    }];
    this.emitMessage({ role: 'assistant', content: 'Conversation reset. How can I help you design?' });
  }
}
