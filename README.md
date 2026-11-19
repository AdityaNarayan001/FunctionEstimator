# FunctionEstimator

FunctionEstimator is a dependency-free static web app for symbolic regression. It evolves readable mathematical expression trees to approximate one-dimensional `(x, y)` data.

## Run

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Test

```sh
npm test
```

The tests use Node only and do not install dependencies.

## Reading the formulas

Operators are protected so that every candidate evaluates to a finite number:

- `log` and `sqrt` act on the absolute value of their input, printed as `log(abs(...))` and `sqrt(abs(...))` when the input can be negative. `log` also adds `1e-6` so that `log(0)` is finite.
- `/` treats a denominator smaller than `1e-6` in magnitude as `1e-6`.
- `exp` clamps its input to `[-12, 12]`, and every value is clamped to `±1e6`.

Away from those edges a printed formula means exactly what it says.
