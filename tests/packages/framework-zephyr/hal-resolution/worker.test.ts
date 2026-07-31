import { describe, it, expect } from 'vitest';
import { lowerHalOp } from '../../../../packages/framework-zephyr/src/lowering/index';
import { setActiveChip } from '../../../../packages/framework-zephyr/src/chips/index';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';

setActiveChip(XIAO_BLE);

// Worker offload: worker.* lowers against the shared __tc_worker_submit/done
// contract (lowerWorkerOp); the Zephyr backing (k_work + k_sem) is emitted by
// the strategy when the program uses worker.* ops. This test locks in that
// both ops lower (the manifest declares worker supported).
describe('worker lowering', () => {
  it('submit → __tc_worker_submit(handle, fn, arg) statement', () => {
    const out = lowerHalOp({ operation: 'worker.submit', handleId: 0, fnRef: 'my_fn', argRef: 'nullptr' } as any);
    expect(out?.code).toBe('__tc_worker_submit(static_cast<int32_t>(0), my_fn, nullptr);');
  });

  it('done → __tc_worker_done(handle) boolean expression', () => {
    const out = lowerHalOp({ operation: 'worker.done', handleId: 1 } as any);
    expect(out?.expression).toBe('__tc_worker_done(static_cast<int32_t>(1))');
  });
});
