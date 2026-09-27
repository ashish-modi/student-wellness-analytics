# Student Wellness Analysis

Predicts a student's mental health score (0–10) from their social media use, sleep, study, physical activity and stress. A scikit-learn model trained on 5,000 students, served through a FastAPI endpoint, with an interactive web UI for what-if analysis.

**🔗 Live demo: [student-wellness-analytics-web.onrender.com](https://student-wellness-analytics-web.onrender.com/)**

> Hosted on Render's free plan: if the app has been idle, the first prediction can take 30–60 seconds while the server wakes up.

> This is an educational ML project, not a clinical assessment tool.

## Features

- **Score prediction:** enter 12 lifestyle and social media signals and get a predicted wellbeing score.
- **Where you sit:** see your score on the distribution of all 5,000 students, with a percentile.
- **Habit levers:** compare your habits with the averages of students who scored 7+, and use **Try** to see how the model responds to a change.
- **Live what-if:** after the first prediction, the score updates as you move the sliders.
- Light and dark themes, responsive layout, and a model online/offline indicator.

## Dataset

`StudentSocialMediaAndMentalHealthImpact.csv`: 5,000 students, 13 columns.

| Type | Columns |
|---|---|
| Numeric | Age, Avg_Daily_Usage_Hours, Daily_Unlocks, Study_Hours, Physical_Activity_Hours, Sleep_Hours_Per_Night |
| Categorical | Gender, Country, Academic_Level, Most_Used_Platform, Purpose_Of_Use, Stress_Level |
| Target | Mental_Health_Score (3.6–9.4, mean 6.23) |

## Approach

The full workflow is in [`project.ipynb`](project.ipynb).

1. **Cleaning:** removed 2 duplicate rows and clipped negative `Physical_Activity_Hours` to 0.
2. **Feature engineering:** grouped the 110 countries into the top 10 most frequent plus `Other`, to avoid 111 one-hot columns.
3. **Preprocessing** (a `ColumnTransformer` inside a `Pipeline`):
   - `Study_Hours`: log transform + standard scaling (skewed)
   - other numeric features: standard scaling
   - `Stress_Level`: ordinal encoding (Low < Medium < High < Very High)
   - gender, academic level, platform, purpose and country: one-hot encoding
4. **Modelling:** 70/30 train–test split, comparing three models.

## Results

| Model | Test R² | Train R² | Test RMSE |
|---|---|---|---|
| Linear Regression | 0.740 | 0.724 | 0.676 |
| **Random Forest** | **0.878** | 0.981 | **0.464** |
| Tuned Random Forest (RandomizedSearchCV) | 0.865 | 0.955 | 0.487 |

The untuned Random Forest scored best on the test set (MAE ≈ 0.35 points on a 0–10 scale), so it is the model saved as `Mental_Health_model.pkl`.

## Project structure

```
├── project.ipynb                               # EDA, preprocessing, training, evaluation
├── Mental_Health_model.pkl                     # trained pipeline (preprocessing + Random Forest)
├── main.py                                     # FastAPI app serving /predict
├── requirements.txt
├── index.html                                  # web UI
├── style.css
└── script.js
```


## API

`POST /predict`

```json
{
  "age": 21,
  "gender": "Female",
  "country": "India",
  "academic_level": "Undergraduate",
  "most_used_platform": "Instagram",
  "purpose_of_use": "Education",
  "avg_daily_usage_hours": 5.0,
  "daily_unlocks": 170,
  "study_hours": 3.0,
  "physical_activity_hours": 1.5,
  "sleep_hours_per_night": 7.0,
  "stress_level": "Medium"
}
```

Response:

```json
{ "predicted_mental_health_score": 6.51 }
```

Allowed values:

- `gender`: Male, Female
- `academic_level`: High School, Undergraduate, Graduate
- `most_used_platform`: Facebook, Instagram, TikTok, YouTube, Snapchat, Twitter, LinkedIn, WhatsApp, WeChat, LINE, KakaoTalk, VKontakte
- `purpose_of_use`: Entertainment, Education, Networking, News
- `stress_level`: Low, Medium, High, Very High

## Limitations

- The habit comparisons show correlations in the dataset, not causes. The model can't say that changing a habit will change someone's wellbeing.
- The training data mostly covers ages 18–24. Predictions for other ages are extrapolation.
- The training R² (0.98) is well above the test R² (0.88), so the Random Forest overfits to some degree.

## Tech stack

Python · pandas · scikit-learn · FastAPI · Pydantic · Uvicorn · HTML/CSS/JavaScript

