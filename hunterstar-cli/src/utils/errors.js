export function isUserCancellation(error) {
    return error?.name === 'ExitPromptError' || error?.name === 'CancelPromptError';
}
