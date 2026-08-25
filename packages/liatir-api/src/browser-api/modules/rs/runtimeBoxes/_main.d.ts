import type { LiatirAPI } from '../../../types';
import type { RuntimeBoxesInterface } from './_types';
export declare function buildRuntimeBoxes(core: {
    invoke: LiatirAPI['invoke'];
}): RuntimeBoxesInterface;
