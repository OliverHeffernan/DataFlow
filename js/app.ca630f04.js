(function(){var e={8205:function(e,t,l){"use strict";var s=l(5130),o=l(6768),n=l(4232),a=l(144),r=(l(4114),l(8490)),i=l(2721);const c={},u=(0,r.v)(i.Q,c);class h{constructor(){h.instance=this}replaceVariables(e,t,l){return e=e.replaceAll("{-","{THISROW-"),e=e.replaceAll("{}","{THISROW}"),e=e.replaceAll("{+","{THISROW+"),e=e.replaceAll("[-","[THISCOL-"),e=e.replaceAll("[]","[THISCOL]"),e=e.replaceAll("[+","[THISCOL+"),e=e.replaceAll("THISROW",t),e=e.replaceAll("THISCOL",l),e=e.replaceAll("PREVROW",t-1),e=e.replaceAll("PREVCOL",l-1),e}replaceSUM(e){return e=e.replace(/SUM\(([^)]+)\)/g,((e,t)=>{try{let e=this.getObjectFromTag(t).SUM;return e}catch(l){return l.message}})),e}replaceAVG(e){return e=e.replace(/AVG\(([^)]+)\)/g,((e,t)=>{try{let e=this.getObjectFromTag(t).AVG;return e}catch(l){return l.message}})),e=e.replace(/MEAN\(([^)]+)\)/g,((e,t)=>{try{let e=this.getObjectFromTag(t).AVG;return e}catch(l){return l.message}})),e}getObjectFromTag(e){return JSON.parse(e.split("<nExTProP*!>")[1])}replaceSUMIF(e){return e=e.replace(/SUMIF\(([^)]+)\)/g,((e,t)=>{const l=t.split("<nExTProP*!>"),s=JSON.parse(l[1]).ARRAY,o=l[2].substring(1,l[2].length-1),n=JSON.parse(l[3]).ARRAY;let a=0,r=o.substring(1);for(let i=0;i<n.length;i++)("="==o[0]&&s[i]==r||"!"==o[0]&&s[i]!=r||"<"==o[0]&&s[i]<r||">"==o[0]&&s[i]>r)&&(a+=Number(n[i]));return a})),e}replaceCOUNTIF(e){return e=e.replace(/COUNTIF\(([^)]+)\)/g,((e,t)=>{const l=t.split("<nExTProP*!>"),s=JSON.parse(l[1]).ARRAY,o=l[2].substring(1,l[2].length-1),n=JSON.parse(l[3]).ARRAY;let a=0,r=o.substring(1);for(let i=0;i<n.length;i++)"="==o[0]&&s[i]==r&&a++;return a})),e}replaceAVGIF(e){return e=e.replace(/AVGIF\(([^)]+)\)/g,((e,t)=>{const l=t.split("<nExTProP*!>"),s=JSON.parse(l[1]).ARRAY,o=l[2].substring(1,l[2].length-1),n=JSON.parse(l[3]).ARRAY;let a=0,r=0,i=o.substring(1);for(let c=0;c<n.length;c++)"="==o[0]&&s[c]==i&&(r+=Number(n[c]),a++);return r/a})),e}replaceCOUNT(e){return e=e.replace(/COUNT\(([^)]+)\)/g,((e,t)=>this.getObjectFromTag(t).COUNT)),e}replaceReferences(e,t){return e=e.replace(/([A-Z])(\d+)/g,((e,l,s)=>t.getValue(s,l.charCodeAt(0)-65))),e}evaluateRefCalcs(e,t){return e=e.replaceAll(/\{([^}]+)\}/g,((e,l)=>{try{const e=u.evaluate(this.replaceReferences(l,t));return e}catch(s){return console.error(`Error evaluating expression "${l}":`,s),console.error(s.message),e}})),e}evaluateLetterRefCalcs(e,t){return e=e.replaceAll(/\[([^\]]+)\]/g,((e,l)=>{try{const e=u.evaluate(this.replaceReferences(l,t));return String.fromCharCode(65+e)}catch(s){return console.error(`Error evaluating expression "${l}":`,s),console.error(s.message),e}})),e}replaceCellRanges(e,t,l,s){let o=!1;return e=e.replace(/\b([A-Z]+\d+):([A-Z]+\d+)\b/g,((e,n,a)=>{const r=n.match(/[A-Z]+/)[0].charCodeAt(0)-65,i=parseInt(n.match(/\d+/)[0]),c=a.match(/[A-Z]+/)[0].charCodeAt(0)-65,u=parseInt(a.match(/\d+/)[0]);if(r<=l&&l<=c&&i<=t&&t<=u)return o=!0,console.error("Circular reference detected for range:",e),JSON.stringify({error:"Circular Reference Detected"});let h=0,d=[],f=0;for(let t=i;t<=u;t++)for(let e=r;e<=c;e++){try{const l=Number(s.getValue(t,e));h+=l}catch{const l=s.getValue(t,e);console.log(l)}d.push(s.getValue(t,e)),f++}const m=h/f;return"<nExTProP*!>"+JSON.stringify({SUM:h,ARRAY:d,COUNT:f,AVG:m})+"<nExTProP*!>"})),o?"circular":e}}class d{constructor(){if(d.instance)return d.instance;this.startRow=null,this.startCol=null,d.instance=this}startVisual(e,t){this.startRow=e,this.startCol=t,this.setVisual(this.startRow,this.startCol)}getSelectionElement(e,t){let l=document.getElementById("visual"+t+":"+e);return l}setVisual(e,t){if(null==this.startRow||null==this.startCol)return;this.clearVisual();let l=Math.min(this.startRow,e);e=Math.max(this.startRow,e);let s=Math.min(this.startCol,t);t=Math.max(this.startCol,t);for(let o=l;o<=e;o++)for(let e=s;e<=t;e++)this.getSelectionElement(o,e).className="sel active"}clearVisual(){const e=document.getElementsByClassName("active"),t=[...e];for(let l=0;l<t.length;l++)t[l].className="sel inactive"}exitVisual(){null==this.startRow&&null==this.startCol||(this.clearVisual(),this.startRow=null,this.startCol=null)}yankSelection(e){let t=e.selRow,l=e.selCol,s=Math.min(this.startRow,t);t=Math.max(this.startRow,t);let o=Math.min(this.startCol,l);l=Math.max(this.startCol,l);let n=[];for(let a=s;a<=t;a++){let t=[];for(let s=o;s<=l;s++)t.push(e.getFormula(a,s));n.push(t)}console.log(n),e.copyBuffer=n}}const f=new h,m={},p=(0,r.v)(i.Q,m),g=new d;class w{constructor(){if(w.instance)return w.instance;this.rows=[],this.styles=[],this.defaultBG="#091119",this.defaultFG="white",this.numOfRows=(0,a.KR)(50),this.numOfCols=(0,a.KR)(50),this.selRow=0,this.selCol=0,this.prevRow=0,this.prevCol=0,this.copyBuffer=[[]],this.path=null,this.defaultStyling={fg:"white",bg:"transparent"};for(let e=0;e<this.numOfRows.value;e++){let e=[],t=[];for(let l=0;l<this.numOfCols.value;l++)e.push(""),t.push({fg:"white",bg:"transparent"});this.rows.push(e),this.styles.push(t)}w.instance=this}clearScreen(){this.rows=[],this.styles=[];for(let e=0;e<this.numOfRows.value;e++){let e=[],t=[];for(let l=0;l<this.numOfCols.value;l++)e.push(""),t.push({fg:"white",bg:"transparent"});this.rows.push(e),this.styles.push(t)}this.loadAllCells(this.numOfRows.value,this.numOfCols.value),this.loadStyles()}loadStyles(){const e=this.numOfCols.value,t=this.numOfRows.value;for(let l=0;l<e;l++)for(let e=0;e<t;e++){const t=this.styles[e][l],s=`:hi bg ${t.bg} fg ${t.fg}`;this.setStyles(s,e,l)}}setStyles(e,t,l){const s=e.split(" ");for(let n=1;n<s.length;n++){const e=s[n],a=(new Option).style;a.color=e;const r=""!==a.color;if("bg"==s[n-1])if(r)try{this.getCell(t,l).style.backgroundColor=s[n],this.styles[t][l].bg=s[n]}catch(o){console.log(o.message)}else this.setPlaceholder(e+"is not a valid CSS color");else if("fg"==s[n-1])if(r){try{this.getCell(t,l).style.color=s[n]}catch(o){console.log(o.message)}this.styles[t][l].fg=s[n]}else this.setPlaceholder(e+"is not a valid CSS color");else"reset"==s[n]?this.resetStyles(t,l):"resetall"==s[n]&&this.resetAllStyles()}}resetStyles(e,t){this.setStyles(":hi fg white bg transparent",e,t)}resetAllStyles(){const e=this.numOfCols.value,t=this.numOfRows.value;let l=[],s=[];for(let o=0;o<e;o++)l.push({fg:this.defaultStyling.fg,bg:this.defaultStyling.bg});for(let o=0;o<t;o++)s.push(l);this.styles=s,this.loadStyles()}getFormula(e,t){try{return this.rows[e][t]}catch(l){return console.log(l.message),""}}getValue(e,t){let l=this.getFormula(e,t);if("="!==l[0])return l;if(l=l.substring(1),l=f.replaceVariables(l,e,t),l=f.evaluateRefCalcs(l,this),l=f.evaluateLetterRefCalcs(l,this),l=l.replaceAll(" ",""),l=f.replaceCellRanges(l,e,t,this),"circular"===l)return"circular logic detected";l=f.replaceSUM(l),l=f.replaceAVG(l),l=f.replaceSUMIF(l),l=f.replaceCOUNTIF(l),l=f.replaceAVGIF(l),l=f.replaceCOUNT(l),l=f.replaceReferences(l,this);try{return p.evaluate(l)}catch(s){return s.message}}selectCell(e,t){try{this.selRow=e,this.selCol=t;let l=document.getElementById("formulaBar");l.value=this.getFormula(e,t),void 0!=this.getSelectedCell()&&(this.getSelectedCell().className="cell"),document.getElementById("cellPicker").value=String.fromCharCode(t+65)+e,this.getCell(e,t).className="focussed cell",this.updateRelRows();let s=t;this.selCol<this.prevCol&&(s=t>1?t-1:0);let o=e;this.selRow>this.prevRow?o=e<this.numOfRows.value-1?e+1:this.numOfRows.value-1:this.selRow<this.prevRow&&(o=e>2?e-2:0),this.getCell(o,s).scrollIntoView({block:"nearest",inline:"nearest"});let n=!1,a=window.scrollX,r=window.scrollY;0==t&&(a=0,n=!0),e==this.numOfRows.value-1&&(r=document.body.scrollHeight,n=!0),e<2&&(r=0,n=!0),n&&window.scrollTo({left:a,top:r}),this.prevRow=this.selRow,this.prevCol=this.selCol,g.setVisual(this.selRow,this.selCol)}catch(l){console.log(l.message)}this.clearPlaceholder()}scrollToCenterSelCell(){let e=this.getCell(this.selRow,this.selCol);e.scrollIntoView({behavior:"smooth",block:"center",inline:"center"})}setFormula(e=!0){this.rows[this.selRow][this.selCol]=document.getElementById("formulaBar").value,this.getCell(this.selRow,this.selCol).innerText=this.getValue(this.selRow,this.selCol),this.loadAllCells(this.numOfRows.value,this.numOfCols.value),e&&this.keyboardMotion(0,1)}yank(e){this.copyBuffer=e}paste(e,t=!1){for(let l=0;l<e;l++){for(let e=0;e<this.copyBuffer.length;e++)for(let t=0;t<this.copyBuffer[e].length;t++)this.rows[this.selRow+e][this.selCol+t]=this.copyBuffer[e][t];this.loadAllCells(this.numOfRows.value,this.numOfCols.value),t?this.keyboardMotion(this.copyBuffer[0].length,0):this.keyboardMotion(0,this.copyBuffer.length)}}pasteInGapRow(e,t){-1==t&&this.keyboardMotion(0,1);const l=this.selRow+1,s=this.selCol,o=this.copyBuffer.length*e;this.insertRowBelow(o),this.selectCell(l,s),this.paste(e,!1)}pasteInGapCol(e,t){-1==t&&this.keyboardMotion(-1,0);const l=this.selRow,s=this.selCol+1,o=this.copyBuffer[0].length*e;this.insertColRight(o),this.selectCell(l,s),this.paste(e,!0)}getCell(e,t){return document.getElementById(t+":"+e)}getSelectedCell(){return document.getElementsByClassName("focussed")[0]}keyboardMotion(e,t){let l=this.selCol+e,s=this.selRow+t;l=Number(Math.max(0,l)),l=Number(Math.min(l,this.numOfCols.value-1)),s=Number(Math.max(0,s)),s=Number(Math.min(s,this.numOfRows.value-1)),this.selectCell(s,l),this.updateRelRows()}updateRelRows(){let e=document.getElementsByClassName("relRow");for(let t=1;t<e.length;t++)e[t].innerText=Math.abs(this.selRow-t+1)}saveSheetToClipboard(){let e=JSON.stringify(this.rows);navigator.clipboard.writeText(e)}loadFromClipboard(){let e=document.getElementById("commandLine"),t=e.value;if(""===t)return void(e.placeholder="Paste the JSON string here, then click 'Load from clipboard'");let l=JSON.parse(t);this.rows=l,this.loadAllCells(l.length,l[0].length),e.value="",this.clearPlaceholder()}clearPlaceholder(){let e=document.getElementById("commandLine");e.placeholder=""}setPlaceholder(e){let t=document.getElementById("commandLine");t.placeholder=e}loadAllCells(e,t){for(let l=0;l<this.numOfRows.value;l++)for(let e=0;e<this.numOfCols.value;e++)try{this.getCell(l,e).innerText=this.getValue(l,e)}catch{console.log("cell not yet loaded")}e>=this.numOfRows.value&&t>=this.numOfCols.value&&this.loadStyles(),this.clearPlaceholder()}removeColAtIndex(e){for(let t=0;t<this.rows.length;t++)this.rows[t].splice(e,1),this.styles[t].splice(e,1);this.loadAllCells(this.numOfRows.value,this.numOfCols.value),this.selectCell(this.selRow,this.selCol)}deleteSelCol(e){for(let t=0;t<e;t++)this.removeColAtIndex(this.selCol)}removeRowAtIndex(e){this.rows.splice(e,1),this.styles.splice(e,1),this.numOfRows.value--,this.loadAllCells(this.numOfRows.value,this.numOfCols.value),this.loadStyles(),this.selectCell(this.selRow,this.selCol)}deleteSelRow(e){for(let t=0;t<e;t++)this.removeRowAtIndex(this.selRow)}insertRowAtIndex(e,t=1){const l=()=>Array.from({length:this.numOfCols.value},(()=>"")),s=()=>Array.from({length:this.numOfCols.value},(()=>({fg:this.defaultStyling.fg,bg:this.defaultStyling.bg}))),o=Array.from({length:t},l),n=Array.from({length:t},s);this.rows.splice(e,0,...o),this.styles.splice(e,0,...n),this.numOfRows.value+=t,this.selectCell(this.selRow,this.selCol)}insertColumnAtIndex(e){for(let t=0;t<this.numOfRows.value;t++)this.rows[t].splice(e,0,""),this.styles[t].splice(e,0,{fg:this.defaultStyling.fg,bg:this.defaultStyling.bg});this.numOfCols.value++,this.loadAllCells(this.numOfRows.value,this.numOfCols.value),this.selectCell(this.selRow,this.selCol)}insertRowBelow(e=1){this.insertRowAtIndex(this.selRow+1,e),this.keyboardMotion(0,1)}insertRowAbove(e=1){for(let t=0;t<e;t++)this.insertRowAtIndex(this.selRow)}insertColRight(e){for(let t=0;t<e;t++)this.insertColumnAtIndex(this.selCol+1),this.keyboardMotion(1,0)}insertColLeft(){this.insertColumnAtIndex(this.selCol)}}const C={class:"tableCell"},y=["id"],v=["id"];var R={__name:"SheetCell",props:{rowNo:{type:Number,required:!0},colNo:{type:Number,required:!0},numOfCols:{type:Number,required:!0},numOfRows:{type:Number,required:!0}},setup(e){const t=new w,l=e;function s(){t.selectCell(l.rowNo,l.colNo),document.getElementById("commandLine").focus()}function n(){t.selectCell(l.rowNo,l.colNo),document.getElementById("formulaBar").focus()}return(0,o.sV)((()=>{l.rowNo==l.numOfRows-1&&l.colNo==l.numOfCols-1&&(t.loadAllCells(t.numOfRows.value,t.numOfCols.value),t.loadStyles())})),(t,l)=>((0,o.uX)(),(0,o.CE)("td",C,[(0,o.Lk)("button",{id:e.colNo+":"+e.rowNo,class:"cell",onDblclick:n,onClick:l[0]||(l[0]=e=>s())},null,40,y),(0,o.Lk)("div",{id:"visual"+e.colNo+":"+e.rowNo,class:"sel inactive"},null,8,v)]))}},b=l(1241);const O=(0,b.A)(R,[["__scopeId","data-v-140bfdeb"]]);var S=O;const I={class:"sheetRow"},A={class:"labels rowLabels"},k={class:"labels relRow"};var E={__name:"SheetRow",props:{rowNo:{type:Number,required:!0},row:{type:Array,required:!0}},setup(e){const t=new w;return(l,s)=>((0,o.uX)(),(0,o.CE)("tr",I,[(0,o.Lk)("td",A,(0,n.v_)(e.rowNo),1),(0,o.Lk)("td",k,(0,n.v_)(e.rowNo),1),((0,o.uX)(!0),(0,o.CE)(o.FK,null,(0,o.pI)(e.row,((l,s)=>((0,o.uX)(),(0,o.Wv)(S,{key:s,rowNo:e.rowNo,colNo:s,numOfRows:(0,a.R1)(t).numOfRows.value,numOfCols:(0,a.R1)(t).numOfCols.value},null,8,["rowNo","colNo","numOfRows","numOfCols"])))),128))]))}};const N=E;var B=N;const F={id:"topBar"};var M={__name:"FormulaBar",setup(e){const t=new w;function l(){t.setFormula(),document.getElementById("commandLine").focus()}function n(){document.getElementById("commandLine").focus()}function a(){let e=document.getElementById("cellPicker").value,l=e.charCodeAt(0)-65,s=parseInt(e.slice(1));const o=/^[A-Z]\d+$/;o.test(e)&&t.selectCell(s,l)}function r(){document.getElementById("formulaBar").focus()}return(e,t)=>((0,o.uX)(),(0,o.CE)("div",F,[(0,o.Lk)("input",{id:"cellPicker",onInput:a,onKeyup:[(0,s.jR)(n,["esc"]),(0,s.jR)(r,["enter"])],type:"text",placeholder:"e.g. A0"},null,32),(0,o.Lk)("input",{id:"formulaBar",type:"text",placeholder:"edit cell formulae",onKeyup:[(0,s.jR)(l,["enter"]),(0,s.jR)(n,["esc"])]},null,32)]))}};const L=(0,b.A)(M,[["__scopeId","data-v-7bcc78f4"]]);var T=L;l(4603),l(7566),l(8721);const x=new w;class P{constructor(){P.instance=this}async saveFile(e=!1){console.log(e),this.downloadFile(JSON.stringify(x.rows),"sheet.dflo")}downloadFile(e,t){const l=new Blob([e],{type:"text/plain"}),s=URL.createObjectURL(l),o=document.createElement("a");o.href=s,o.download=t,o.click(),URL.revokeObjectURL(s)}async openFile(){document.getElementById("webFileUpload").style.display="block"}setPhMessage(e){document.getElementById("commandLine").placeholder=e}}class V{constructor(){if(V.instance)return V.instance;this.displayed=(0,a.KR)(!0),V.instance=this}hide(){this.displayed.value=!1}}const _=new w,j=new P,U=new d,G=new V;class X{constructor(){this.mode="n",this.selStartRow=null,this.selStartCol=null,X.instance=this}setPhMessage(e){document.getElementById("commandLine").placeholder=e}checkCommand(){this.setPhMessage(""),console.log(this.mode);let e=document.getElementById("commandLine").value;if(""==e)return;let t=document.getElementById("formulaBar"),l=document.getElementById("cellPicker"),s=!1;if("i"==e)t.focus(),t.setSelectionRange(0,0),s=!0;else if("a"==e){t.focus();const e=t.value.length;t.setSelectionRange(e,e),s=!0}else if("v"==e)this.mode="v",this.selStartRow=_.selRow,this.selStartCol=_.selCol,U.startVisual(_.selRow,_.selCol),s=!0;else if("I"==e)_.selectCell(_.selRow,0),t.focus(),s=!0;else if("^"==e)_.selectCell(_.selRow,0),s=!0;else if("$"==e)_.selectCell(_.selRow,_.numOfCols.value-1),s=!0;else if("c"==e)t.value="",t.focus(),_.setFormula(!1),s=!0;else if(";"==e)l.focus(),l.value="",s=!0;else if("zz"==e)_.scrollToCenterSelCell(),s=!0;else if("oj"==e)_.insertRowBelow(),s=!0;else if("ok"==e)_.insertRowAbove(),s=!0;else if("oh"==e)_.insertColLeft(),s=!0;else if("ol"==e)_.insertColRight(),s=!0;else if("yf"==e&&"v"==this.mode){console.log("visual selection");let e=_.selCol,t=_.selRow,l=_.getFormula(t,e);navigator.clipboard.writeText(l),U.yankSelection(_),console.log(_.copyBuffer),s=!0,this.handleEsc()}else if("yf"==e){let e=_.selCol,t=_.selRow,l=_.getFormula(t,e);navigator.clipboard.writeText(l),_.yank([[l]]),s=!0}else if("ys"==e){let e=_.selCol,t=_.selRow,l=_.getValue(t,e);navigator.clipboard.writeText(l),_.yank([[l]]),s=!0}else if("yy"==e){const e=_.selRow;let t=_.rows[e],l=t.lastIndexOf("");t=-1===l?t:t.slice(0,l+1),_.yank([t]),s=!0}else if("gg"==e){let e=_.selCol;_.selectCell(0,e),s=!0}else if("G"==e){let e=_.selCol,t=_.numOfRows.value-1;_.selectCell(t,e),s=!0}let o=this.parseCommand(e).amount,n=this.parseCommand(e).command;"h"==n?(_.keyboardMotion(-o,0),s=!0):"j"==n?(_.keyboardMotion(0,o),s=!0):"k"==n?(_.keyboardMotion(0,-o),s=!0):"l"==n?(_.keyboardMotion(o,0),s=!0):"p"==n?(_.paste(o,!1),s=!0):"Pj"==n?(_.pasteInGapRow(o,1),s=!0):"Pk"==n?(_.pasteInGapRow(o,-1),s=!0):"Pl"==n?(_.pasteInGapCol(o,1),s=!0):"Ph"==n?(_.pasteInGapCol(o,-1),s=!0):"dd"==n?(_.deleteSelRow(o),s=!0):"dc"==n&&(_.deleteSelCol(o),s=!0),s&&(document.getElementById("commandLine").value="")}handleEnter(){let e=document.getElementById("commandLine").value;if(":w"==e)j.saveFile();else if(":forceloadstyles"==e)_.loadStyles();else if(":wa"==e)j.saveFile(!0);else if(":o"==e)j.openFile(),G.hide();else if(":clear"==e)_.clearScreen(),G.hide();else if(e.startsWith(":hi")){const t=_.selRow,l=_.selCol;_.setStyles(e,t,l)}else":resetallstyles"==e&&_.resetAllStyles();document.getElementById("commandLine").value=""}handleEsc(){U.exitVisual(),this.mode="n",document.getElementById("commandLine").value=""}parseCommand(e){const t=e.match(/^(\d+)?(.+)$/);if(!t)return null;const[l,s,o]=t;return{amount:s?parseInt(s,10):1,command:o}}}const J={id:"webFileUpload"};var K={__name:"CommandLine",setup(e){const t=new w,l=new X;function n(){document.getElementById("webFileUpload").style.display="none"}function r(){const e=document.getElementById("fileInput"),l=e.files[0];console.log("web view");const s=new FileReader;s.onload=function(e){console.log(e.target.result),t.rows=JSON.parse(e.target.result),t.numOfRows.value=t.rows.length,t.numOfCols.value=t.rows[0].length,t.loadAllCells()},s.readAsText(l),document.getElementById("webFileUpload").style.display="none"}return(e,t)=>((0,o.uX)(),(0,o.CE)(o.FK,null,[(0,o.Lk)("input",{id:"commandLine",placeholder:"command line here",spellcheck:"false",type:"text",onInput:t[0]||(t[0]=e=>(0,a.R1)(l).checkCommand()),onKeyup:[t[1]||(t[1]=(0,s.jR)((e=>(0,a.R1)(l).handleEnter()),["enter"])),t[2]||(t[2]=(0,s.jR)((e=>(0,a.R1)(l).handleEsc()),["esc"]))]},null,32),(0,o.Lk)("div",J,[t[5]||(t[5]=(0,o.Lk)("input",{id:"fileInput",type:"file"},null,-1)),(0,o.Lk)("button",{id:"readFileBtn",onClick:t[3]||(t[3]=e=>r())},"Read File"),(0,o.Lk)("button",{id:"cancelButton",onClick:t[4]||(t[4]=e=>n())},"Cancel")])],64))}};const H=K;var W=H,q=l.p+"img/128x128.38894798.png";const Y=["id"],$=85,Z=0,D=.2;var Q={__name:"BlurBubble",props:{colour:{type:String,required:!0}},setup(e){const t=e;let l,s=100*Math.random(),a=100*Math.random();(0,o.sV)((()=>{l=document.getElementById(t.colour),console.log(l),requestAnimationFrame(c),console.log(l.style.top)}));let r=2*Math.random()*Math.PI,i=.2;function c(){r+=Math.random()*D*2-D;while(r<0)r+=2*Math.PI;while(r>=2*Math.PI)r-=2*Math.PI;const e=s+i*Math.cos(r),t=a+i*Math.sin(r);(e<Z||e>$)&&(r=Math.PI-r),(t<Z||t>$)&&(r=-r),s+=i*Math.cos(r),a+=i*Math.sin(r),l.style.top=a+"%",l.style.left=s+"%",requestAnimationFrame(c)}return(t,l)=>((0,o.uX)(),(0,o.CE)("div",{style:(0,n.Tr)("background-color:"+e.colour+";"),class:"bubble",id:e.colour},null,12,Y))}};const z=(0,b.A)(Q,[["__scopeId","data-v-4777ac8b"]]);var ee=z;const te={id:"splashScreen"};var le={__name:"FirstLaunchScreen",setup(e){const t=["blue","lightblue","white"];return(e,l)=>((0,o.uX)(),(0,o.CE)("div",te,[l[0]||(l[0]=(0,o.Fv)('<h1 data-v-5a6fdc0a> Welcome to DataFlow </h1><img src="'+q+'" data-v-5a6fdc0a><h2 data-v-5a6fdc0a> Harness the speed of light </h2><h2 data-v-5a6fdc0a> Commands are entered into the input field at the bottom of the screen.</h2><h2 data-v-5a6fdc0a>Commands</h2><h3 data-v-5a6fdc0a><span class="keystroke" data-v-5a6fdc0a>:clear</span> to create a blank spreadsheet.</h3><h3 data-v-5a6fdc0a><span class="keystroke" data-v-5a6fdc0a>:help</span> to open the documentation.</h3><h3 data-v-5a6fdc0a><span class="keystroke" data-v-5a6fdc0a>:o</span> to open a file.</h3><h3 data-v-5a6fdc0a><span class="keystroke" data-v-5a6fdc0a>:w</span> to save a file.</h3><h3 data-v-5a6fdc0a><span class="keystroke" data-v-5a6fdc0a>:wa</span> to save a file as.</h3><div id="fadeIn" data-v-5a6fdc0a></div>',11)),((0,o.uX)(),(0,o.CE)(o.FK,null,(0,o.pI)(t,((e,t)=>(0,o.bF)(ee,{colour:e,key:t},null,8,["colour"]))),64))]))}};const se=(0,b.A)(le,[["__scopeId","data-v-5a6fdc0a"]]);var oe=se,ne={__name:"App",setup(e){const t=(0,a.KR)(new V),l=(0,a.KR)(new w);return(e,s)=>((0,o.uX)(),(0,o.CE)(o.FK,null,[t.value.displayed?((0,o.uX)(),(0,o.Wv)(oe,{key:0})):(0,o.Q3)("",!0),(0,o.bF)(T),(0,o.bF)(W),(0,o.Lk)("table",null,[(0,o.Lk)("thead",null,[(0,o.Lk)("tr",null,[s[0]||(s[0]=(0,o.Lk)("th",{class:"rowLabelType rowLabels"},"abs",-1)),s[1]||(s[1]=(0,o.Lk)("th",{class:"rowLabelType relRow"},"rel",-1)),((0,o.uX)(!0),(0,o.CE)(o.FK,null,(0,o.pI)(l.value.numOfRows,((e,t)=>((0,o.uX)(),(0,o.CE)("th",{key:t,class:"labels colLabels"},(0,n.v_)(String.fromCharCode(t+65)),1)))),128))])]),(0,o.Lk)("tbody",null,[((0,o.uX)(!0),(0,o.CE)(o.FK,null,(0,o.pI)(l.value.rows,((e,t)=>((0,o.uX)(),(0,o.Wv)(B,{key:t,row:e,rowNo:t},null,8,["row","rowNo"])))),128))])])],64))}};const ae=ne;var re=ae;const ie=(0,s.Ef)(re);ie.mount("#app")},1234:function(){}},t={};function l(s){var o=t[s];if(void 0!==o)return o.exports;var n=t[s]={id:s,loaded:!1,exports:{}};return e[s].call(n.exports,n,n.exports,l),n.loaded=!0,n.exports}l.m=e,function(){l.amdD=function(){throw new Error("define cannot be used indirect")}}(),function(){l.amdO={}}(),function(){var e=[];l.O=function(t,s,o,n){if(!s){var a=1/0;for(u=0;u<e.length;u++){s=e[u][0],o=e[u][1],n=e[u][2];for(var r=!0,i=0;i<s.length;i++)(!1&n||a>=n)&&Object.keys(l.O).every((function(e){return l.O[e](s[i])}))?s.splice(i--,1):(r=!1,n<a&&(a=n));if(r){e.splice(u--,1);var c=o();void 0!==c&&(t=c)}}return t}n=n||0;for(var u=e.length;u>0&&e[u-1][2]>n;u--)e[u]=e[u-1];e[u]=[s,o,n]}}(),function(){l.n=function(e){var t=e&&e.__esModule?function(){return e["default"]}:function(){return e};return l.d(t,{a:t}),t}}(),function(){l.d=function(e,t){for(var s in t)l.o(t,s)&&!l.o(e,s)&&Object.defineProperty(e,s,{enumerable:!0,get:t[s]})}}(),function(){l.g=function(){if("object"===typeof globalThis)return globalThis;try{return this||new Function("return this")()}catch(e){if("object"===typeof window)return window}}()}(),function(){l.o=function(e,t){return Object.prototype.hasOwnProperty.call(e,t)}}(),function(){l.r=function(e){"undefined"!==typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})}}(),function(){l.nmd=function(e){return e.paths=[],e.children||(e.children=[]),e}}(),function(){l.p="/DataFlow/"}(),function(){var e={524:0};l.O.j=function(t){return 0===e[t]};var t=function(t,s){var o,n,a=s[0],r=s[1],i=s[2],c=0;if(a.some((function(t){return 0!==e[t]}))){for(o in r)l.o(r,o)&&(l.m[o]=r[o]);if(i)var u=i(l)}for(t&&t(s);c<a.length;c++)n=a[c],l.o(e,n)&&e[n]&&e[n][0](),e[n]=0;return l.O(u)},s=self["webpackChunkdataflow"]=self["webpackChunkdataflow"]||[];s.forEach(t.bind(null,0)),s.push=t.bind(null,s.push.bind(s))}();var s=l.O(void 0,[504],(function(){return l(8205)}));s=l.O(s)})();
//# sourceMappingURL=app.ca630f04.js.map