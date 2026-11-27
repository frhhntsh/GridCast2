import json
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score, precision_recall_fscore_support

# Setup styling
sns.set_theme(style="whitegrid")
plt.rcParams.update({'font.size': 12})

print("Loading data...")
with open('public/data/gridcast_data.json', 'r') as f:
    data = json.load(f)

# Setup timeline (2021 data)
t0 = pd.date_range("2021-01-01", periods=8760, freq="h")
actual = np.array(data['actual_mw'])
models = ['XGBoost', 'CatBoost', 'LightGBM']
forecasts = {m: np.array(data['forecast_mw'][m]) for m in models}

# ---------------------------------------------------------
# 1. REGRESSION METRICS (MAE, RMSE, MAPE, R2)
# ---------------------------------------------------------
metrics = {'Model': [], 'MAE': [], 'RMSE': [], 'MAPE (%)': [], 'R2': []}
for m in models:
    fc = forecasts[m]
    metrics['Model'].append(m)
    metrics['MAE'].append(mean_absolute_error(actual, fc))
    metrics['RMSE'].append(np.sqrt(mean_squared_error(actual, fc)))
    metrics['MAPE (%)'].append(np.mean(np.abs((actual - fc) / actual)) * 100)
    metrics['R2'].append(r2_score(actual, fc))

df_metrics = pd.DataFrame(metrics)

fig, axes = plt.subplots(2, 2, figsize=(14, 10))
fig.suptitle('Model Regression Metrics Comparison (Test Set 2021)', fontsize=16)

sns.barplot(data=df_metrics, x='Model', y='RMSE', ax=axes[0,0], palette='Oranges_r').set_title('RMSE (Lower is Better)')
sns.barplot(data=df_metrics, x='Model', y='MAE', ax=axes[0,1], palette='Blues_r').set_title('MAE (Lower is Better)')
sns.barplot(data=df_metrics, x='Model', y='MAPE (%)', ax=axes[1,0], palette='Greens_r').set_title('MAPE % (Lower is Better)')
sns.barplot(data=df_metrics, x='Model', y='R2', ax=axes[1,1], palette='Purples_r').set_title('R-Squared (Higher is Better)')

plt.tight_layout()
plt.savefig("1_Regression_Metrics.png", dpi=300)
print("Saved: 1_Regression_Metrics.png")

# ---------------------------------------------------------
# 2. PEAK DETECTION METRICS (Precision, Recall, F1)
# ---------------------------------------------------------
# Define peak as > 90th percentile of actual load
threshold = np.percentile(actual, 90)
act_peak = actual >= threshold

peak_metrics = {'Model': [], 'Precision': [], 'Recall': [], 'F1-Score': []}
for m in models:
    pred_peak = forecasts[m] >= threshold
    prec, rec, f1, _ = precision_recall_fscore_support(act_peak, pred_peak, average='binary', zero_division=0)
    peak_metrics['Model'].append(m)
    peak_metrics['Precision'].append(prec)
    peak_metrics['Recall'].append(rec)
    peak_metrics['F1-Score'].append(f1)

df_peak = pd.DataFrame(peak_metrics).melt(id_vars='Model', var_name='Metric', value_name='Score')

plt.figure(figsize=(10, 6))
sns.barplot(data=df_peak, x='Model', y='Score', hue='Metric', palette=['#F36F21', '#1B2A41', '#4C8DF6'])
plt.title('Peak Detection Performance (Top 10% Highest Load Hours)')
plt.ylim(0, 1.1)
plt.legend(loc='lower right')
plt.tight_layout()
plt.savefig("2_Peak_Detection_F1.png", dpi=300)
print("Saved: 2_Peak_Detection_F1.png")

# ---------------------------------------------------------
# 3. ERROR DISTRIBUTION (Residuals Histogram)
# ---------------------------------------------------------
plt.figure(figsize=(10, 5))
errors = actual - forecasts['XGBoost']
sns.histplot(errors, bins=50, kde=True, color='purple')
plt.title('Error Distribution (Actual - XGBoost Forecast)')
plt.xlabel('Error (MW)')
plt.ylabel('Frequency')
plt.axvline(0, color='red', linestyle='dashed', linewidth=2)
plt.tight_layout()
plt.savefig("3_Error_Distribution.png", dpi=300)
print("Saved: 3_Error_Distribution.png")

# ---------------------------------------------------------
# 4. ACTUAL VS PREDICTED SCATTER PLOT
# ---------------------------------------------------------
plt.figure(figsize=(8, 8))
plt.scatter(actual, forecasts['XGBoost'], alpha=0.1, color='#F36F21')
plt.plot([actual.min(), actual.max()], [actual.min(), actual.max()], 'k--', lw=2)
plt.title('Actual vs Predicted Load (XGBoost)')
plt.xlabel('Actual Load (MW)')
plt.ylabel('Predicted Load (MW)')
plt.tight_layout()
plt.savefig("4_Scatter_Actual_vs_Pred.png", dpi=300)
print("Saved: 4_Scatter_Actual_vs_Pred.png")

# ---------------------------------------------------------
# 5. MONTHLY MAE (Seasonality of errors)
# ---------------------------------------------------------
df_month = pd.DataFrame({'error': np.abs(errors)}, index=t0)
monthly_mae = df_month.resample('M').mean()

plt.figure(figsize=(12, 4))
monthly_mae.plot(kind='bar', color='teal', legend=False, ax=plt.gca())
plt.title('Monthly Mean Absolute Error (XGBoost)')
plt.ylabel('MAE (MW)')
plt.xlabel('Month in 2021')
plt.xticks(rotation=45)
plt.tight_layout()
plt.savefig("5_Monthly_MAE.png", dpi=300)
print("Saved: 5_Monthly_MAE.png")

# ---------------------------------------------------------
# 6. CONFUSION MATRIX (Peak vs Non-Peak for XGBoost)
# ---------------------------------------------------------
from sklearn.metrics import confusion_matrix
pred_peak_xgb = forecasts['XGBoost'] >= threshold
cm = confusion_matrix(act_peak, pred_peak_xgb)
plt.figure(figsize=(6, 5))
sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', 
            xticklabels=['Predicted Normal', 'Predicted Peak'], 
            yticklabels=['Actual Normal', 'Actual Peak'])
plt.title('Confusion Matrix: Peak Detection (XGBoost)')
plt.tight_layout()
plt.savefig("6_Confusion_Matrix.png", dpi=300)
print("Saved: 6_Confusion_Matrix.png")

# ---------------------------------------------------------
# 7. HEATMAP (Average Load by Day and Hour)
# ---------------------------------------------------------
df_heat = pd.DataFrame({'load': actual}, index=t0)
pivot = df_heat.pivot_table(index=df_heat.index.dayofweek, columns=df_heat.index.hour, values='load', aggfunc='mean')
plt.figure(figsize=(12, 5))
sns.heatmap(pivot, cmap='YlOrRd')
plt.title('Average Load Heatmap by Day of Week and Hour')
plt.xlabel('Hour of Day')
plt.ylabel('Day of Week (0=Mon, 6=Sun)')
plt.tight_layout()
plt.savefig("7_Load_Heatmap.png", dpi=300)
print("Saved: 7_Load_Heatmap.png")

print("\nALL DONE! 7 high-quality charts generated for your thesis.")