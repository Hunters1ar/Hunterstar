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
