#pragma once

struct Config {
  int versao = 0;
  int porcao_g = 0;
  int limite_diario_g = 0;
  int n_horarios = 0;
  char horarios[6][6];
  int agua_min = 0;
  int agua_alvo = 0;
};