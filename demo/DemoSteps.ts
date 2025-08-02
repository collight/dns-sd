import chalk from 'chalk'

export async function delay(ms: number) {
  return new Promise(res => setTimeout(res, ms))
}

type StepFn = () => void | Promise<void>

export class DemoSteps {
  private steps: { label: string; durationMs: number; fn: StepFn }[] = []

  step(...args: [label: string, fn: StepFn] | [durationMs: number, label: string, fn: StepFn]): this {
    if (args.length === 2) {
      const [label, fn] = args
      this.steps.push({ durationMs: 1000, label, fn })
    } else {
      const [durationMs, label, fn] = args
      this.steps.push({ durationMs, label, fn })
    }
    return this
  }

  async run() {
    const total = this.steps.length
    for (let i = 0; i < total; i++) {
      const { durationMs, label, fn } = this.steps[i]!
      const prefix = chalk.cyanBright.bold(`[${i + 1} / ${total}]`)
      const desc = chalk.white.bold(label)

      const startTime = performance.now()
      console.log(`\n${prefix} ${desc}`)
      await fn()

      const endTime = performance.now()
      if (endTime - startTime < durationMs) {
        await delay(durationMs - (endTime - startTime))
      }
    }
  }

  async runForever(label: string, fn?: StepFn) {
    await this.run()

    const footer = chalk.greenBright.bold(`\n${label}`)
    console.log(footer)
    await fn?.()

    await new Promise(() => {
      return
    })
  }
}
