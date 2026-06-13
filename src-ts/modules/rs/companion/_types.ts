import { CompanionState } from "../../../companion_context";

export interface CompanionInterface {
  launch: (appConfig?: CompanionConfig) => Promise<void>;
  state: CompanionState;
}


export type CompanionConfig = {
  /**
   * URL da caricare nella companion window.
   * Può essere:
   *  - una stringa ("/companion", "/settings", "https://example.com")
   */
  url?: string;

  /**
   * Background color della finestra companion
   */
  backgroundColor?: string;

  /**
   * Titolo della finestra companion
   */
  title?: string;

  /**
   * Larghezza iniziale della finestra
   */
  width?: number;

  /**
   * Altezza iniziale della finestra
   */
  height?: number;

  /**
   * Se la finestra può essere ridimensionata
   */
  resizable?: boolean;

  /**
   * Se deve aprirsi in fullscreen
   * (accetta sia openFullscreen che open_fullscreen)
   */
  openFullscreen?: boolean;

  /**
   * Spazio libero per parametri aggiuntivi
   * che vorrai trasmettere al companion
   */
  // [key: string]: unknown;
};
