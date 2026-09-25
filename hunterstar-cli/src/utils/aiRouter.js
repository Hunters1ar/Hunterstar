export const FAST_API_URL = "https://fast.moonlightsoldiers.xyz/v1/chat/completions";
export const HEAVY_API_URL = "https://heavy.moonlightsoldiers.xyz/v1/chat/completions";
export const API_KEY = "hunterella@152634879man";

export const FAST_MODEL = "Qwen2.5-1.5B";
export const HEAVY_MODEL = "Qwen3.6-35B-A3B";

const CODE_KEYWORDS = /\b(code|script|function|def|class|interface|type|struct|enum|const|let|var|import|export|from|return|async|await|regex|sql|json|yaml|xml|html|css|javascript|typescript|python|bash|powershell|cmd|git|npm|docker|api|endpoint|ast|algorithm|refactor|compile|build|deploy)\b/i;
const DEBUG_KEYWORDS = /\b(debug|debugging|bug|fix|error|exception|traceback|stacktrace|stack trace|crash|crashed|failing|fails|failed|broken|issue|fatal|syntax error|nullpointer|undefined is not|segfault|timeout)\b/i;
const COMMAND_KEYWORDS = /\b(execute|run|exec|launch|start|stop|restart|kill|terminate|install|uninstall|npm|pip|cargo|git|docker|curl|wget|chmod|chown|ps|pkill|find|search|grep|cat|ls|dir|inspect|folder|directory|files?|delete|remove|erase|clear|clean|purge|destroy|create|make|write|edit|modify|update|copy|move|rename|show|list|open|download|clone|pull|push|commit|diff|add|del|rm|Get-ChildItem|Select-String)\b/i;
const PATH_PATTERN = /[a-zA-Z]:\\|\/(?:usr|var|etc|bin|home|root|tmp)\b|\b\w+\.(?:js|ts|py|json|html|css|cpp|c|cs|rs|go|sh|ps1|bat|md|yaml|yml)\b/i;

// Add audit/analyze keywords to force Tier: HEAVY
export const HEAVY_ANALYSIS_REGEX = /\b(analyze|audit|scan|leak|security|inspect|structure|vulnerability|project|refactor|fix|check|overview|recommend|suggestion|improve)\b/i;

export function routeTier(userPrompt) {
    if (!userPrompt) return 'fast';
    const clean = userPrompt.trim();
    if (clean.startsWith('/heavy')) return 'heavy';
    if (clean.startsWith('/fast')) return 'fast';
    if (HEAVY_ANALYSIS_REGEX.test(clean)) return 'heavy';
    return 'fast'; // Only greetings and 3-word chatter stay fast
}

const SYSTEM_METRIC_KEYWORDS = /\b(ram|memory|cpu|gpu|vram|swap|pagefile|disk|storage|ssd|hdd|drive|drives|partition|partitions|volume|volumes|processes?|tasklist|taskmgr|services?|daemons?|specs|hardware|motherboard|battery|bandwidth|network|wifi|ethernet|ports?|sockets?|netstat|ipconfig|ifconfig|ping|traceroute|dns|firewall|uptime|systeminfo|neofetch|fastfetch)\b/i;
const SYSTEM_ACTION_KEYWORDS = /\b(analyze|analyzing|analysis|monitor|monitoring|benchmark|benchmarking|diagnose|diagnostic|diagnostics|troubleshoot|troubleshooting|audit|auditing|profile|profiling|measure|measuring|consuming|consumption|utilization|usage|bottleneck|throttl(?:e|ing)|overheat(?:ing)?|temps?|temperature|free space|disk space)\b/i;
const OS_ADMIN_KEYWORDS = /\b(Get-Process|Stop-Process|Start-Process|Get-Service|Start-Service|Stop-Service|Restart-Service|Get-Counter|Get-WmiObject|Get-CimInstance|Get-Volume|Get-Disk|Get-NetTCPConnection|Get-NetIPAddress|Test-NetConnection|top|htop|btop|free|vmstat|iostat|df|du|lsof|fuser|netstat|ss|systemctl|journalctl|dmesg|tasklist|taskkill|systeminfo|wmic|chkdsk|sfc|dism|netsh)\b/i;
const SYSTEM_INSPECTION_PATTERN = /(?:analyze|check|monitor|inspect|examine|show|list|display|find|what(?:\s+is|\s+are)?|how\s+much|why\s+is)\s+.*(?:ram|memory|cpu|gpu|disk|storage|drive|space|process|task|service|port|network|usage|performance|consuming|resource|system)/i;

/**
 * Classifies a user prompt and determines whether to route to the Fast Chat tier
 * (Qwen2.5-1.5B) or the Heavy Coding tier (Qwen3.6-35B-A3B MoE).
 *
 * @param {string} prompt - The user prompt
 * @param {object} options
 * @param {Array} options.messages - Previous conversation messages
 * @param {string} options.forcedTier - 'auto', 'fast', or 'heavy'
 * @param {number} options.steps - Current agent execution step
 * @param {string} [options.fastUrl] - Optional custom fast endpoint
 * @param {string} [options.heavyUrl] - Optional custom heavy endpoint
 * @returns {{ tier: 'fast'|'heavy', endpoint: string, model: string, reason: string, label: string }}
 */
export function classifyPromptTier(prompt, {
    messages = [],
    forcedTier = 'auto',
    steps = 1,
    fastUrl = FAST_API_URL,
    heavyUrl = HEAVY_API_URL
} = {}) {
    const forced = (forcedTier || 'auto').toLowerCase().trim();

    if (forced === 'fast') {
        return {
            tier: 'fast',
            endpoint: fastUrl || FAST_API_URL,
            model: FAST_MODEL,
            reason: 'Manual tier override (fast)',
            label: 'Fast Chat Tier (1.5B)'
        };
    }

    if (forced === 'heavy') {
        return {
            tier: 'heavy',
            endpoint: heavyUrl || HEAVY_API_URL,
            model: HEAVY_MODEL,
            reason: 'Manual tier override (heavy)',
            label: 'Heavy Coding Tier (35B MoE)'
        };
    }

    // Agent execution loop continuation must stay on Heavy tier
    if (steps > 1) {
        return {
            tier: 'heavy',
            endpoint: heavyUrl || HEAVY_API_URL,
            model: HEAVY_MODEL,
            reason: `Agent step ${steps} in progress`,
            label: 'Heavy Coding Tier (35B MoE)'
        };
    }

    // Active tool call or error repair context (only check non-system messages)
    const nonSystemMessages = messages.filter(m => m && m.role !== 'system');
    const lastNonSystem = nonSystemMessages[nonSystemMessages.length - 1];
    if (lastNonSystem && typeof lastNonSystem.content === 'string' && (
        lastNonSystem.content.includes('[EXECUTION RESULT]') ||
        lastNonSystem.content.includes('[PROTOCOL ERROR]') ||
        lastNonSystem.content.includes('<dots_function_response>')
    )) {
        return {
            tier: 'heavy',
            endpoint: heavyUrl || HEAVY_API_URL,
            model: HEAVY_MODEL,
            reason: 'Active agent tool execution context',
            label: 'Heavy Coding Tier (35B MoE)'
        };
    }

    const clean = (prompt || '').trim();
    if (!clean) {
        return {
            tier: 'fast',
            endpoint: fastUrl || FAST_API_URL,
            model: FAST_MODEL,
            reason: 'Empty prompt',
            label: 'Fast Chat Tier (1.5B)'
        };
    }

    // Explicit one-off tier commands
    if (clean.startsWith('/heavy')) {
        return {
            tier: 'heavy',
            endpoint: heavyUrl || HEAVY_API_URL,
            model: HEAVY_MODEL,
            reason: 'Manual tier command (/heavy)',
            label: 'Heavy Coding Tier (35B MoE)'
        };
    }

    if (clean.startsWith('/fast')) {
        return {
            tier: 'fast',
            endpoint: fastUrl || FAST_API_URL,
            model: FAST_MODEL,
            reason: 'Manual tier command (/fast)',
            label: 'Fast Chat Tier (1.5B)'
        };
    }

    // Audit, security, secret leak detection & project analysis -> Heavy
    if (HEAVY_ANALYSIS_REGEX.test(clean)) {
        return {
            tier: 'heavy',
            endpoint: heavyUrl || HEAVY_API_URL,
            model: HEAVY_MODEL,
            reason: 'Security, audit, or project analysis query',
            label: 'Heavy Coding Tier (35B MoE)'
        };
    }

    // 1. Multi-line prompts -> Heavy
    if (clean.includes('\n') && clean.split('\n').filter(l => l.trim()).length > 1) {
        return {
            tier: 'heavy',
            endpoint: heavyUrl || HEAVY_API_URL,
            model: HEAVY_MODEL,
            reason: 'Multi-line prompt',
            label: 'Heavy Coding Tier (35B MoE)'
        };
    }

    // 2. Code blocks or inline backticks -> Heavy
    if (/```[\s\S]*?```/.test(clean) || /`[^`\n]+`/.test(clean)) {
        return {
            tier: 'heavy',
            endpoint: heavyUrl || HEAVY_API_URL,
            model: HEAVY_MODEL,
            reason: 'Code block or syntax identifier',
            label: 'Heavy Coding Tier (35B MoE)'
        };
    }

    // 3. Debugging / error analysis requests -> Heavy
    if (DEBUG_KEYWORDS.test(clean)) {
        return {
            tier: 'heavy',
            endpoint: heavyUrl || HEAVY_API_URL,
            model: HEAVY_MODEL,
            reason: 'Debugging / error request',
            label: 'Heavy Coding Tier (35B MoE)'
        };
    }

    // 4. Code tasks, programming keywords & syntax -> Heavy
    if (CODE_KEYWORDS.test(clean)) {
        return {
            tier: 'heavy',
            endpoint: heavyUrl || HEAVY_API_URL,
            model: HEAVY_MODEL,
            reason: 'Code task / programming query',
            label: 'Heavy Coding Tier (35B MoE)'
        };
    }

    // 5. System metrics, diagnostics, resource analysis & OS admin commands -> Heavy
    if (OS_ADMIN_KEYWORDS.test(clean) || SYSTEM_INSPECTION_PATTERN.test(clean) || (SYSTEM_METRIC_KEYWORDS.test(clean) && SYSTEM_ACTION_KEYWORDS.test(clean))) {
        return {
            tier: 'heavy',
            endpoint: heavyUrl || HEAVY_API_URL,
            model: HEAVY_MODEL,
            reason: 'System resource / diagnostic analysis request',
            label: 'Heavy Coding Tier (35B MoE)'
        };
    }

    // 6. System commands, file manipulation, and system paths -> Heavy
    if (COMMAND_KEYWORDS.test(clean) || PATH_PATTERN.test(clean)) {
        return {
            tier: 'heavy',
            endpoint: heavyUrl || HEAVY_API_URL,
            model: HEAVY_MODEL,
            reason: 'System / command execution request',
            label: 'Heavy Coding Tier (35B MoE)'
        };
    }

    // 7. High complexity / lengthy prompt -> Heavy
    if (clean.length > 160 || clean.split(/\s+/).length > 30) {
        return {
            tier: 'heavy',
            endpoint: heavyUrl || HEAVY_API_URL,
            model: HEAVY_MODEL,
            reason: 'High-complexity prompt',
            label: 'Heavy Coding Tier (35B MoE)'
        };
    }

    // 8. Default: Casual chatter, short questions, instant banter -> Fast
    return {
        tier: 'fast',
        endpoint: fastUrl || FAST_API_URL,
        model: FAST_MODEL,
        reason: 'Casual chatter / instant banter',
        label: 'Fast Chat Tier (1.5B)'
    };
}

