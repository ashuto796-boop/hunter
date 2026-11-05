from math import comb

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.core.combinatorics import combos_masks, combos_table
from app.core.grid import (
    Grid,
    GridValidationError,
    combination_rank,
    combination_unrank,
    grid_from_index,
    grid_index,
    validate_grid,
)
from app.core.rules import get_era

numbers_st = st.lists(st.integers(1, 50), min_size=5, max_size=5, unique=True)
stars_st = st.lists(st.integers(1, 12), min_size=2, max_size=2, unique=True)


@given(numbers_st, stars_st)
def test_index_roundtrip(numbers, stars):
    g = Grid.create(numbers, stars)
    idx = g.index()
    assert 0 <= idx < 139_838_160
    assert grid_from_index(idx) == g


def test_index_extremes():
    assert grid_index((1, 2, 3, 4, 5), (1, 2)) == 0
    assert grid_index((46, 47, 48, 49, 50), (11, 12)) == 139_838_160 - 1


@given(st.integers(0, comb(50, 5) - 1))
def test_unrank_rank(rank):
    assert combination_rank(combination_unrank(rank, 5, 50)) == rank


@pytest.mark.parametrize(
    "numbers,stars",
    [
        ([1, 2, 3, 4], [1, 2]),
        ([1, 2, 3, 4, 4], [1, 2]),
        ([0, 2, 3, 4, 5], [1, 2]),
        ([1, 2, 3, 4, 51], [1, 2]),
        ([1, 2, 3, 4, 5], [1, 1]),
        ([1, 2, 3, 4, 5], [1, 13]),
        ([1, 2, 3, 4, 5], [1]),
    ],
)
def test_invalid_grids(numbers, stars):
    with pytest.raises(GridValidationError):
        validate_grid(numbers, stars)


def test_era_specific_star_bounds():
    with pytest.raises(GridValidationError):
        validate_grid([1, 2, 3, 4, 5], [1, 10], get_era("E2004"))
    validate_grid([1, 2, 3, 4, 5], [1, 9], get_era("E2004"))


def test_sorting():
    g = Grid.create([50, 3, 17, 1, 22], [9, 2])
    assert g.numbers == (1, 3, 17, 22, 50)
    assert g.stars == (2, 9)


def test_combos_table_consistent_with_rank():
    table = combos_table()
    assert table.shape == (comb(50, 5), 5)
    rng = np.random.default_rng(0)
    for i in rng.integers(0, table.shape[0], 200):
        assert combination_rank(table[i].tolist()) == i
    masks = combos_masks()
    assert len(np.unique(masks)) == comb(50, 5)
    assert np.all(np.bitwise_count(masks) == 5)
