db.getCollection("comments").remove({});
db.getCollection("posts").updateMany(
  {},
  {
    $set: {
      likesCount: 0,
      sharesCount: 0,
      commentCount: 0,
      likes: []
    }
  }
);
db.getCollection("profilebookmarks").remove({});
db.getCollection("profilecomments").remove({})
db.getCollection("profilefollowers").remove({});
db.getCollection("profilefollowings").remove({});
db.getCollection("profilelikes").remove({});
db.getCollection("profileshares").remove({});

db.getCollection("profiles").updateMany(
  {},
  {
    $set: {
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      bookmarksCount: 0,
      followingCount: 0,
      followersCount: 0,
      updated_at: new Date()
    }
  }
);

db.getCollection("commentaudios").remove({});

db.getCollection("activities").remove({});

db.getCollection("profiles").updateMany(
    {},
    {
        $set: {
            "bookmarksCount": 0,
            "commentsCount": 0,
            "followersCount": 0,
            "followingCount": 0,
            "likesCount": 0,
            "sharesCount": 0,
            "updated_at": new Date()
        }
    }
);

// encontrar y eliminar posts creados en modeDiscovery
db.getCollection("posts").deleteMany({
  
})