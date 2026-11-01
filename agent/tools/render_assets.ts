import { randomUUID } from "node:crypto";
import { defineTool } from "eve/tools";
import { z } from "zod";

const MAX_BYTES = 1_500_000; // tool outputs are stored with the session: keep them small

export default defineTool({
  description:
    "Render the LinkedIn carousel (PDF + previews) and the email HTML in a real headless browser " +
    "inside the sandbox. Returns a layout report: overflowing slides and email width.",
  inputSchema: z.object({
    pageTitle: z.string().max(120),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    slides: z.array(z.object({ headline: z.string().max(80), body: z.string().max(240) })).min(3).max(8),
    emailHtml: z.string().max(40_000),
  }),
  async execute(input, ctx) {
    const sandbox = await ctx.getSandbox();
    const dir = `jobs/${randomUUID()}`;
    await sandbox.writeTextFile({ path: `${dir}/job.json`, content: JSON.stringify(input) });
    const run = await sandbox.run({ command: `node render.mjs ${dir}/job.json ${dir}/out` });
    if (run.exitCode !== 0) throw new Error(`Render failed: ${run.stderr || run.stdout}`);

    const read = async (f: string) =>
      Buffer.from((await sandbox.readBinaryFile({ path: `${dir}/out/${f}` })) ?? []).toString("base64");
    const report = JSON.parse((await sandbox.readTextFile({ path: `${dir}/out/report.json` })) ?? "{}");
    const files = {
      carouselPdf: await read("carousel.pdf"),
      slidePreviews: await Promise.all(input.slides.map((_, i) => read(`slide-${i + 1}.jpg`))),
      emailPreview: await read("email.jpg"),
    };
    const size = JSON.stringify(files).length;
    if (size > MAX_BYTES) throw new Error(`Rendered files are too large (${size} bytes). Use fewer slides.`);
    return { report, ...files };
  },
  // The model only needs the QA report, not the base64 files (the app reads those).
  toModelOutput: ({ report }) => ({ type: "text", value: `Render report: ${JSON.stringify(report)}` }),
});
