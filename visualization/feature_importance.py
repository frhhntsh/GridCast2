import json
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import xgboost as xgb

print("Loading data...")
# 1. Load your actual data from the JSON
with open('public/data/gridcast_data.json', 'r') as f:
    data = json.load(f)

actual_mw = np.array(data['actual_mw'])
t0 = pd.date_range("2021-01-01", periods=8760, freq="h")

# 2. Re-create the features (exactly like your pipeline did)
df = pd.DataFrame({'load': actual_mw}, index=t0)
df['hour'] = df.index.hour
df['dayofweek'] = df.index.dayofweek

# Create time-lags (the most important features in your project)
df['lag_1'] = df['load'].shift(1)
df['lag_2'] = df['load'].shift(2)
df['lag_24'] = df['load'].shift(24)
df['lag_168'] = df['load'].shift(168)

# Drop missing values created by the shift
df = df.dropna()

# 3. Train a quick XGBoost model to extract the Feature Importance
features = ['lag_1', 'lag_2', 'lag_24', 'lag_168', 'hour', 'dayofweek']
X = df[features]
y = df['load']

print("Training XGBoost model to extract weights...")
model = xgb.XGBRegressor(n_estimators=100, max_depth=5, random_state=42)
model.fit(X, y)

# 4. Extract and sort the feature importances
importances = model.feature_importances_
indices = np.argsort(importances)

# 5. Plot the chart
sns.set_theme(style="whitegrid")
plt.figure(figsize=(10, 6))

# Use a nice orange/navy palette to match your project
colors = ['#9DB4D3' if i != len(indices)-1 else '#F36F21' for i in range(len(indices))]
plt.barh(range(len(indices)), importances[indices], color=colors, align='center')

# Label the axes
plt.yticks(range(len(indices)), [features[i] for i in indices], fontsize=12)
plt.xlabel('Relative Importance Score', fontsize=12)
plt.title('Explainable AI: XGBoost Feature Importance', fontsize=14, fontweight='bold')

# Add percentage labels to the bars
for i, v in enumerate(importances[indices]):
    plt.text(v + 0.005, i, f"{v*100:.1f}%", va='center', fontweight='bold')

plt.tight_layout()
plt.savefig("8_Feature_Importance.png", dpi=300)
print("Saved: 8_Feature_Importance.png")