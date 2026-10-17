/** 全局执行锁：计划执行与单用例回放/录制互斥 */
let planRunning = false

export function setPlanRunning(running: boolean): void {
  planRunning = running
}

export function isPlanRunning(): boolean {
  return planRunning
}
