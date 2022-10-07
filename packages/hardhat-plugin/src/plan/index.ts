import type { IgnitionPlan } from "@nomicfoundation/ignition-core";
import { exec } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";

import * as utils from "./utils";

/**
 * file structure output:
 *
 *  cache/
 *    plan/
 *      execution/
 *        <vertex>.html
 *      recipe/
 *        <vertex>.html
 *      index.html
 */

interface RendererConfig {
  cachePath: string;
  network: NetworkSettings;
}

interface NetworkSettings {
  name: string;
  id: number | string;
}

interface LoadedTemplates {
  [name: string]: string;
}

const regex = /%(\w+)%/g;

export class Renderer {
  private _templates: LoadedTemplates = {};

  constructor(
    public recipeName: string,
    public plan: IgnitionPlan,
    public config: RendererConfig
  ) {
    // ensure `plan` file structure once on construction
    // so we don't have to before every write function later
    this._ensureDirectoryStructure();
  }

  public write(): void {
    this._loadHTMLAssets();

    // title bar
    const title = this._templates.title.replace(
      regex,
      utils.replacer({ recipeName: this.recipeName })
    );

    // summary
    const networkName = this.config.network.name;
    const networkId = this.config.network.id as string;
    const txTotal = utils.getTxTotal(this.plan.recipeGraph);
    const summaryLists = utils.getSummaryLists(this.plan.recipeGraph);
    const summary = this._templates.summary.replace(
      regex,
      utils.replacer({ networkName, networkId, txTotal, summaryLists })
    );

    // plan
    const mermaid = utils.wrapInMermaidDiv(
      utils.graphToMermaid(
        this.plan.recipeGraph,
        this.recipePath,
        this.recipeName
      )
    );
    const actions = utils.getActions(this.plan.recipeGraph);
    const plan = this._templates.plan.replace(
      regex,
      utils.replacer({ mermaid, actions })
    );

    // index.html
    const mainOutput = this._templates.index.replace(
      regex,
      utils.replacer({ title, summary, plan })
    );

    this._writeMainHTML(mainOutput);

    // the stringify in these loops is just a first draft version
    // they'll be full html pages with styles at some point
    for (const vertex of this.plan.recipeGraph.vertexes.values()) {
      this._writeRecipeHTML(vertex.id, JSON.stringify(vertex, null, 2));
    }

    // for (const vertex of this.plan.executionGraph.vertexes.values()) {
    //   this._writeExecutionHTML(vertex.id, JSON.stringify(vertex, null, 2));
    // }
  }

  /**
   * opens the main `plan` file in the user's default browser
   *
   * assumes Renderer.write() was called before this
   */
  public open(): void {
    let command: string;
    switch (os.platform()) {
      case "win32":
        command = "start";
        break;
      case "darwin":
        command = "open";
        break;
      default:
        command = "xdg-open";
    }

    exec(`${command} ${path.resolve(this.planPath, "index.html")}`);
  }

  public get planPath(): string {
    return path.resolve(this.config.cachePath, "plan");
  }

  public get recipePath(): string {
    return path.resolve(this.planPath, "recipe");
  }

  public get executionPath(): string {
    return path.resolve(this.planPath, "execution");
  }

  private get _assetsPath(): string {
    return path.resolve(__dirname, "assets");
  }

  private get _templatesPath(): string {
    return path.resolve(this._assetsPath, "templates");
  }

  private _writeExecutionHTML(id: number, text: string): void {
    fs.writeFileSync(`${this.executionPath}/${id}.json`, text, "utf8");
  }

  private _writeRecipeHTML(id: number, text: string): void {
    fs.writeFileSync(`${this.recipePath}/${id}.json`, text, "utf8");
  }

  private _writeMainHTML(text: string): void {
    fs.writeFileSync(`${this.planPath}/index.html`, text, "utf8");
  }

  private _loadHTMLAssets(): void {
    const templateFiles = fs.readdirSync(this._templatesPath);

    for (const file of templateFiles) {
      this._templates[file.split(".")[0]] = fs.readFileSync(
        `${this._templatesPath}/${file}`,
        "utf8"
      );
    }
  }

  private _copyUserAssets(): void {
    const filenames = fs.readdirSync(this._assetsPath);
    for (const file of filenames) {
      if (file !== "templates") {
        fs.copyFileSync(
          `${this._assetsPath}/${file}`,
          `${this.planPath}/${file}`
        );
      }
    }
  }

  private _ensureDirectoryStructure(): void {
    fs.ensureDirSync(this.recipePath);
    fs.ensureDirSync(this.executionPath);
    this._copyUserAssets();
  }
}
