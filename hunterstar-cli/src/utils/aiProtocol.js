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
