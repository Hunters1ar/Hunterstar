export function parseAiCommand(text) {
    if (/<\/?(?:dots_function_call|invoke|parameter|tool_call|function_call)\b/i.test(text)) {
        return { error: 'Unsupported or malformed XML tool call. Use exactly one [EXEC]command[/EXEC] block with a command for the active shell. No command was executed.' };
    }
    const blocks = [...text.matchAll(/\[EXEC\]([\s\S]*?)\[\/EXEC\]/g)];
    const markers = text.match(/\[\/?EXEC\]/gi) || [];
    if (markers.length && (blocks.length !== 1 || markers.length !== 2 || !blocks[0][1].trim())) {
        return { error: 'Invalid execution format. Return exactly one complete, nonempty [EXEC]command[/EXEC] block. No command was executed.' };
    }
    if (blocks.length === 1) {
        return { command: blocks[0][1].trim(), normalText: text.slice(0, blocks[0].index).trim(), suggestion: false };
    }
    const suggestion = text.match(/```(?:bash|cmd|powershell|sh)\r?\n([\s\S]*?)\r?\n```/);
    return { command: suggestion?.[1]?.trim(), normalText: text, suggestion: Boolean(suggestion) };
}

export function extractRescuedCommand(text) {
    if (!text || typeof text !== 'string') return null;

    // 1. Explicit [EXEC] block (take the last complete block since that represents the model's final conclusion)
    const execBlocks = [...text.matchAll(/\[EXEC\]([\s\S]*?)\[\/EXEC\]/g)];
    if (execBlocks.length > 0) {
        const cmd = execBlocks[execBlocks.length - 1][1].trim();
        if (cmd) return cmd;
    }

    // If there is an explicit final summary/answer section and NO [EXEC] block,
    // do NOT mistake mentions of cmdlets in the thoughts as an unexecuted command!
    const hasExplicitAnswer = /(?:###?\s+(?:Final\s+)?(?:Results?|Findings?|Summary|Conclusion|Overview)|(?:Final\s+(?:answer|response|summary|report|findings)|In\s+summary|Summary|Conclusion|Here\s+(?:is|are)\s+(?:the\s+)?(?:results?|findings?|models?|files?|summary)|Based\s+on\s+(?:the|these)\s+results?)[:\s]+)/i.test(text);
    if (hasExplicitAnswer) {
        return null;
    }

    // 2. Fenced code block (```powershell ... ``` or ```bash ... ```)
    const fencedMatches = [...text.matchAll(/```(?:bash|cmd|powershell|sh|pwsh)?\r?\n([\s\S]*?)\r?\n```/g)];
    if (fencedMatches.length > 0) {
        const cmd = fencedMatches[fencedMatches.length - 1][1].trim();
        if (cmd) return cmd;
    }

    // 3. Command explicitly labeled in text: "Final command: `...`" or "Command to construct: `...`"
    const labeledMatch = text.match(/(?:Final command|Command to construct|Refined command|Command to use|Command|Execute|Run)[:\s]+`?([a-zA-Z0-9_\-]+(?:\s+[^`\r\n]+))`?/i);
    if (labeledMatch && labeledMatch[1]) {
        const candidate = labeledMatch[1].trim().replace(/^`+|[.`]+$/g, '');
        if (candidate.length > 2) return candidate;
    }

    // 4. Backtick enclosed shell cmdlet or command
    const backtickMatches = [...text.matchAll(/`((?:Get-|Select-|Where-|Format-|Stop-|Start-|Set-|New-|Remove-|Test-|git |npm |dir |ls |cat |ps |curl |docker |pkill |tasklist |systeminfo )[^`\n]+)`/gi)];
    if (backtickMatches.length > 0) {
        const cmd = backtickMatches[backtickMatches.length - 1][1].trim();
        if (cmd) return cmd;
    }

    // 5. Standalone line starting with a known cmdlet or CLI tool
    const lineMatches = [...text.matchAll(/^[ \t]*((?:Get-|Select-|Where-|Format-|Stop-|Start-|Set-|New-|Remove-|Test-|git\s|npm\s|curl\s|docker\s|tasklist|systeminfo|wmic\s)[^\r\n]+)/gmi)];
    if (lineMatches.length > 0) {
        const cmd = lineMatches[lineMatches.length - 1][1].trim().replace(/^`+|[.`]+$/g, '');
        if (cmd.length > 2) return cmd;
    }

    return null;
}

export function extractRescuedAnswer(text) {
    if (!text || typeof text !== 'string') return '';

    let clean = text.replace(/<\/?think>/gi, '').trim();

    // 1. Check for explicit final answer/summary sections
    const markerMatch = clean.match(/(?:(?:Final\s+(?:answer|response|summary|report|findings|verdict)|In\s+summary|Summary|Conclusion|Here\s+(?:is|are)\s+(?:the\s+|all\s+)?(?:results?|findings?|models?|files?|summary|items?|what\s+I\s+found)|Based\s+on\s+(?:the|these)\s+(?:results?|findings?|search)|Search\s+complete[d]?|Found\s+\d+\s+[^:\n]+)[:\s]+)([\s\S]+)/i);
    if (markerMatch && markerMatch[1].trim().length > 15) {
        return markerMatch[1].trim();
    }

    // 2. Check for markdown headings (### or ## or #) which indicate structured user-facing output
    const headingMatch = clean.match(/(?:^|\n)(#{1,3}\s+[^\n]+[\s\S]+)/);
    if (headingMatch && headingMatch[1].trim().length > 15) {
        return headingMatch[1].trim();
    }

    // 3. Filter out meta-thought lines at the start (e.g. "I will...", "Let me...", "1. Understand user request...")
    const lines = clean.split('\n');
    let startIdx = 0;
    while (startIdx < lines.length) {
        const line = lines[startIdx].trim();
        if (!line || /^(?:I\s+(?:need|will|should|have|am\s+going|must|can|would)|Let\s+me|Looking\s+at|Thinking|Step\s+\d|^\d+\.\s+(?:Understand|Analyze|Check|Execute|Search)|The\s+user\s+(?:wants|asked|is)|Okay,?\s+so|Now\s+I\s+(?:need|should|will))/i.test(line)) {
            startIdx++;
        } else {
            break;
        }
    }

    const trimmedLines = lines.slice(startIdx).join('\n').trim();
    if (trimmedLines.length > 15) {
        return trimmedLines;
    }

    return clean;
}
