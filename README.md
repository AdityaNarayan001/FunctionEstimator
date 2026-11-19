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
