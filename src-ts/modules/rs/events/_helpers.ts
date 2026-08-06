// NOTE: Always return the real Tauri unlisten function to avoid confusion.
export type Unlisten = () => void;

export const listenForEvent = async (
  event: string,
  handler: (payload: any) => void
): Promise<Unlisten> => {
  // Use the injected Tauri API
  const tauri = (window as any).__TAURI__;
  const eventApi = tauri?.event;
  if (!eventApi?.listen) throw new Error("Tauri event API not available");

  // Register listener and return the unlisten function directly
  const unlisten: Unlisten = await eventApi.listen(event, (e: any) => {
    // Forward only the payload to the user handler
    handler(e?.payload);
  });

  return unlisten;
};