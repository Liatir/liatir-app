import type { LiatirAPI } from '../../../types';
import type { SingleCellIndexesInterface } from './_types';
export declare function buildSingleCellIndexes(core: {
    invoke: LiatirAPI['invoke'];
}): SingleCellIndexesInterface;
