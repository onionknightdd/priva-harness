import { escapeScriptText, jsonForScript } from "./escape-script"
import {
  VISUALIZE_SANDBOX_CSP,
  VISUALIZE_SANDBOX_CSS,
} from "./sandbox-css"

export function createVisualizeSrcdoc(input: {
  runtimeJs: string
  userJs: string
  themeCss: string
  frameId: string
}): string {
  const runtime = escapeScriptText(input.runtimeJs)
  const user = escapeScriptText(input.userJs)
  const frameId = jsonForScript(input.frameId)
  const themeCss = input.themeCss.replace(/<\/style/gi, "<\\/style")
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${VISUALIZE_SANDBOX_CSP}">
<style>
${VISUALIZE_SANDBOX_CSS}
${themeCss}
</style>
</head>
<body>
<div id="root"></div>
<script>${runtime}</script>
<script>
(function () {
  var frameId = ${frameId};
  var React = window.React;
  var sandbox = window.VisualizeSandbox;
  if (!React || !sandbox) {
    throw new Error("visualize sandbox runtime failed to load");
  }
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useCallback = React.useCallback;
  var useRef = React.useRef;
  var useId = React.useId;
  var useReducer = React.useReducer;
  var Fragment = React.Fragment;
  var Button = sandbox.components.Button;
  var Badge = sandbox.components.Badge;
  var Card = sandbox.components.Card;
  var CardHeader = sandbox.components.CardHeader;
  var CardTitle = sandbox.components.CardTitle;
  var CardDescription = sandbox.components.CardDescription;
  var CardContent = sandbox.components.CardContent;
  var Progress = sandbox.components.Progress;
  var Separator = sandbox.components.Separator;
  try {
    ${user}
    var Root = typeof App === "function" ? App : typeof Preview === "function" ? Preview : null;
    if (!Root) {
      throw new Error("visualize needs a function named App or a JSX snippet");
    }
    sandbox.mount(Root, frameId);
  } catch (error) {
    sandbox.reportError(frameId, error);
  }
})();
</script>
</body>
</html>`
}
