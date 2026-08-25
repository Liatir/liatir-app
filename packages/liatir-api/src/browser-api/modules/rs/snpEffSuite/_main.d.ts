import type { LiatirAPI } from '../../../types';
import type { SnpEffSuiteInterface } from './_types';
export declare function buildSnpEffSuite(core: {
    invoke: LiatirAPI['invoke'];
}): SnpEffSuiteInterface;
