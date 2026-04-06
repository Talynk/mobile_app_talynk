export function isQueryCancelledError(error: unknown) {
  if (!error) {
    return false;
  }

  if (typeof error === 'string') {
    return error.includes('CancelledError') || error.toLowerCase().includes('cancelled');
  }

  if (typeof error === 'object') {
    const maybeError = error as { name?: string; message?: string };
    return (
      maybeError.name === 'CancelledError' ||
      maybeError.message === 'CancelledError' ||
      maybeError.message?.includes('CancelledError') === true ||
      maybeError.message?.toLowerCase().includes('cancelled') === true
    );
  }

  return false;
}

export async function runQuerySafely(
  action: () => Promise<unknown>,
  context: string,
) {
  try {
    await action();
  } catch (error) {
    if (isQueryCancelledError(error)) {
      return;
    }

    console.warn(`[Query] ${context} failed:`, error);
  }
}
