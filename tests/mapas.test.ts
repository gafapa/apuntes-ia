// Escalas de los mapas de datos y épocas del atlas de fronteras históricas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claseDe, cortes, gama, redondear, textosClases } from '../web/src/lib/mapasEscala';
import { archivoFronteras, añoFronteras, textoAño } from '../shared/fronteras';

test('cortes por cuantiles y por intervalos iguales', () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.deepEqual(cortes(v, 2, 'iguales'), [5.5]);
  assert.deepEqual(cortes(v, 5, 'iguales'), [2.8, 4.6, 6.4, 8.2]);
  assert.deepEqual(cortes(v, 2), [5.5]);
  // Muchos valores repetidos: los cuantiles no separan nada y se usan intervalos iguales
  assert.deepEqual(cortes([1, 1, 1, 1, 9], 4), [3, 5, 7]);
  assert.deepEqual(cortes([2, 2, 2], 3), []);
  assert.deepEqual(cortes([4], 5), []);
});

test('clase de cada valor y textos de la leyenda', () => {
  const l = [10, 20];
  assert.equal(claseDe(5, l), 0);
  assert.equal(claseDe(10, l), 0);
  assert.equal(claseDe(15, l), 1);
  assert.equal(claseDe(25, l), 2);
  assert.deepEqual(textosClases(l, '%'), ['≤ 10 %', '10 % – 20 %', '> 20 %']);
  assert.equal(redondear(12345), 12300);
  assert.equal(redondear(0.045678), 0.0457);
});

test('gama de colores entre dos o más paradas', () => {
  assert.deepEqual(gama(['#000000', '#ffffff'], 3), ['#000000', '#808080', '#ffffff']);
  assert.deepEqual(gama(['#ff0000', '#00ff00', '#0000ff'], 3), ['#ff0000', '#00ff00', '#0000ff']);
  assert.throws(() => gama(['rojo', '#fff'], 2), /Color no válido/);
});

test('fronteras: el año con mapa más cercano y su archivo', () => {
  assert.equal(añoFronteras(1000), 1000);
  assert.equal(añoFronteras(1031), 1000);
  assert.equal(añoFronteras(1490), 1492);
  assert.equal(archivoFronteras(-218), 'world_bc200.geojson');
  assert.equal(archivoFronteras(1914), 'world_1914.geojson');
  assert.equal(textoAño(-200), '200 a. C.');
  assert.equal(textoAño(1492), '1492');
});
