import * as c from '../web/js/catalog.js';
const names = ['H-MILCH 3,5%','BANANE','TOMATEN RISPEN','JA! BUTTER 250G','COCA COLA 1,0L','PFAND 0,25 EURO','BAGUETTE','Toilettenpapier 8x','Mineralwasser 1,5L','LATTE PS ESSELUNGA 1L','MOZZARELLA S.LUCIA','PASTA BARILLA PENNE','ACQUA SAN BENEDETTO 6X','DETERSIVO PIATTI SVELTO','PANE CASERECCIO','PROSCIUTTO COTTO','PARMIGIANO REGG. 24M','VINO ROSSO CHIANTI','OLIO EXTRA VERGINE IL','Vollkornbrot','Hackfleisch gem.','REIS BASMATI','PREISVORTEIL','TK PIZZA SALAME','Gouda jung Scheiben','Spaghetti 500g','EIS VANILLE','Peperoni rossi','Salame Milano','Zahnpasta','RITTER SPORT','Kartoffeln festk.'];
for (const n of names) console.log(n.padEnd(26), c.guessCategory(n).padEnd(10), c.prettyName(n));
const items=[{price:1.29},{price:1.99},{price:1.79,discount:-0.3},{price:1.58},{price:0.25},{price:0.25},{price:3.49}];
console.log('reconcile', c.reconcileWithTotal(items, 9.44));
console.log(c.similarity(c.productKey('H-MILCH 3,5%'), c.productKey('H MILCH 3,5 %')), c.similarity(c.productKey('VOLLMILCH 3,5% 1L'), c.productKey('Vollmilch 3,5% 1L')));
